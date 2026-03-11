import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import {
  BadgeCheck,
  BriefcaseBusiness,
  Calculator,
  Building2,
  Search,
  RefreshCw,
  Clock,
  Activity,
  Shield,
  Users,
  X,
} from 'lucide-react';

type RequiredField = {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required: boolean;
  description?: string;
};

type IntegrationRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  authType: 'api_key' | 'oauth2' | string;
  tags: string[];
  color?: string;
  priority?: number;
  requiredFields: RequiredField[];
  status: 'disconnected' | 'connected' | 'error' | 'syncing' | 'expired' | string;
  lastSyncAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
  connectionId?: string | null;
};

type ConnectionLog = {
  id: string;
  action: string;
  status: string;
  message: string | null;
  metadata?: any;
  created_at: string;
};

function statusTone(status: IntegrationRow['status']): 'connected' | 'pending' | 'error' | 'neutral' {
  if (status === 'connected') return 'connected';
  if (status === 'syncing') return 'pending';
  if (status === 'error' || status === 'expired') return 'error';
  return 'neutral';
}

const statusToneClasses: Record<ReturnType<typeof statusTone>, string> = {
  connected: 'border-emerald-400/20 bg-emerald-400/12 text-emerald-100',
  pending: 'border-amber-400/20 bg-amber-400/12 text-amber-100',
  error: 'border-rose-400/20 bg-rose-400/12 text-rose-100',
  neutral: 'border-white/10 bg-white/[0.05] text-slate-300',
};

function formatStatusLabel(status: IntegrationRow['status']): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'syncing':
      return 'Syncing';
    case 'expired':
      return 'Expired';
    case 'error':
      return 'Needs attention';
    default:
      return 'Disconnected';
  }
}

function iconForCategory(category: string) {
  const upper = category.toUpperCase();
  if (upper.includes('HR')) return Users;
  if (upper.includes('FINANCE')) return Calculator;
  if (upper.includes('COMPLIANCE')) return Shield;
  if (upper.includes('RECRUIT')) return BriefcaseBusiness;
  return Building2;
}

function parseOAuthToastFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  const service = params.get('service');
  const message = params.get('message');

  if (!status) return;

  if (status === 'connected') {
    toast.success(`Connected ${service || 'integration'}.`);
  } else if (status === 'error') {
    toast.error(message ? String(message) : `Failed to connect ${service || 'integration'}.`);
  } else {
    toast.info('Integration flow updated.');
  }

  // Clear query params so refresh doesn't replay.
  try {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  } catch {
    // ignore
  }
}

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 2)}••••••••${value.slice(-2)}`;
}

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IntegrationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disconnected' | 'error' | 'syncing' | 'expired'>('all');
  const [authFilter, setAuthFilter] = useState<'all' | 'api_key' | 'oauth2'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [phaseFilter, setPhaseFilter] = useState<'all' | 1 | 2 | 3 | 4>('all');

  const [active, setActive] = useState<IntegrationRow | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, 'testing' | 'disconnecting' | null>>({});

  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [logActionBusy, setLogActionBusy] = useState<'refreshing' | null>(null);

  const connectedCount = useMemo(() => items.filter((it) => it.status === 'connected').length, [items]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => set.add(it.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      const phase = it.priority === 1 ? 1 : it.priority === 2 ? 2 : it.priority === 3 ? 3 : 4;
      const matchesQuery = !q || `${it.name} ${it.category} ${it.description} ${it.id}`.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' ? true : it.status === statusFilter;
      const matchesAuth = authFilter === 'all' ? true : it.authType === authFilter;
      const matchesCategory = categoryFilter === 'all' ? true : it.category === categoryFilter;
      const matchesPhase = phaseFilter === 'all' ? true : phase === phaseFilter;
      return matchesQuery && matchesStatus && matchesAuth && matchesCategory && matchesPhase;
    });
  }, [items, query, statusFilter, authFilter, categoryFilter, phaseFilter]);

  const groupedByPhase = useMemo(() => {
    const groups: Record<1 | 2 | 3 | 4, IntegrationRow[]> = { 1: [], 2: [], 3: [], 4: [] };
    filteredItems.forEach((it) => {
      const phase = it.priority === 1 ? 1 : it.priority === 2 ? 2 : it.priority === 3 ? 3 : 4;
      groups[phase].push(it);
    });
    (Object.keys(groups) as Array<'1' | '2' | '3' | '4'>).forEach((key) => {
      groups[Number(key) as 1 | 2 | 3 | 4].sort((a, b) => a.name.localeCompare(b.name));
    });
    return groups;
  }, [filteredItems]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const res = await api.integrations.getAll();
    if (!res.success) {
      setItems([]);
      setLoadError(res.error || 'Failed to load integrations');
      setLoading(false);
      return;
    }
    setItems((res.data as IntegrationRow[]) || []);
    setLoading(false);
  }

  const selectedIntegration = useMemo(() => {
    if (!selectedIntegrationId) return null;
    return items.find((it) => it.id === selectedIntegrationId) || null;
  }, [items, selectedIntegrationId]);

  async function loadLogs(serviceId: string) {
    setLogLoading(true);
    setLogError(null);
    const res = await api.integrations.getLogs(serviceId, 20);
    if (!res.success) {
      setLogs([]);
      setLogError(res.error || 'Failed to load connection history');
      setLogLoading(false);
      return;
    }
    setLogs((res.data as ConnectionLog[]) || []);
    setLogLoading(false);
  }

  const openDetails = async (integration: IntegrationRow) => {
    setSelectedIntegrationId(integration.id);
    await loadLogs(integration.id);
  };

  const closeDetails = () => {
    setSelectedIntegrationId(null);
    setLogs([]);
    setLogError(null);
    setLogLoading(false);
    setLogActionBusy(null);
  };

  useEffect(() => {
    parseOAuthToastFromQuery();
    void load();
  }, []);

  const openConnect = (integration: IntegrationRow) => {
    // OAuth integrations with no extra fields can jump directly into the OAuth flow.
    if (integration.authType === 'oauth2' && integration.requiredFields.length === 0) {
      const returnTo = '/dashboard/integrations';
      void (async () => {
        const init = await api.integrations.initOAuth(integration.id, returnTo);
        if (!init.success || !init.data?.url) {
          toast.error(init.error || 'Failed to start OAuth connection');
          return;
        }
        window.location.href = init.data.url;
      })();
      return;
    }

    setActive(integration);
    const seed: Record<string, string> = {};
    integration.requiredFields.forEach((field) => {
      seed[field.name] = '';
    });
    setCredentials(seed);
  };

  const closeConnect = () => {
    setActive(null);
    setCredentials({});
    setSubmitting(false);
  };

  const connect = async () => {
    if (!active) return;
    setSubmitting(true);

    const missing = active.requiredFields.filter((f) => f.required && !credentials[f.name]);
    if (missing.length > 0) {
      toast.error(`Missing required fields: ${missing.map((m) => m.label).join(', ')}`);
      setSubmitting(false);
      return;
    }

    if (active.authType === 'oauth2') {
      // Only allow non-secret fields to be passed via query params.
      const returnTo = '/dashboard/integrations';
      const connection: Record<string, string> = {};
      active.requiredFields.forEach((field) => {
        const value = credentials[field.name];
        if (!value) return;
        if (field.type === 'password') return;
        connection[field.name] = value;
      });
      const init = await api.integrations.initOAuth(active.id, returnTo, connection);
      if (!init.success || !init.data?.url) {
        toast.error(init.error || 'Failed to start OAuth connection');
        setSubmitting(false);
        return;
      }
      window.location.href = init.data.url;
      return;
    }

    const res = await api.integrations.connect(active.id, credentials);
    if (!res.success) {
      toast.error(res.error || 'Failed to connect integration');
      setSubmitting(false);
      return;
    }
    toast.success(`Connected ${active.name}.`);
    closeConnect();
    await load();
  };

  const disconnect = async (integration: IntegrationRow) => {
    setRowBusy((prev) => ({ ...prev, [integration.id]: 'disconnecting' }));
    const res = await api.integrations.disconnect(integration.id);
    if (!res.success) {
      toast.error(res.error || 'Failed to disconnect integration');
      setRowBusy((prev) => ({ ...prev, [integration.id]: null }));
      return;
    }
    toast.success(`Disconnected ${integration.name}.`);
    await load();
    setRowBusy((prev) => ({ ...prev, [integration.id]: null }));
  };

  const test = async (integration: IntegrationRow) => {
    setRowBusy((prev) => ({ ...prev, [integration.id]: 'testing' }));
    const res = await api.integrations.test(integration.id);
    if (!res.success) {
      toast.error(res.error || 'Test failed');
      setRowBusy((prev) => ({ ...prev, [integration.id]: null }));
      return;
    }
    const ok = (res.data as any)?.success ?? (res.data as any)?.data?.success;
    const message = (res.data as any)?.message || (res.data as any)?.data?.message;
    if (ok) toast.success(message || 'Connection ok');
    else toast.error(message || 'Connection failed');
    await load();
    setRowBusy((prev) => ({ ...prev, [integration.id]: null }));
  };

  const refreshToken = async (integration: IntegrationRow) => {
    setLogActionBusy('refreshing');
    const res = await api.integrations.refresh(integration.id);
    if (!res.success) {
      toast.error(res.error || 'Refresh failed');
      setLogActionBusy(null);
      return;
    }
    toast.success('Token refreshed.');
    await load();
    await loadLogs(integration.id);
    setLogActionBusy(null);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.75))] p-7 shadow-[0_20px_70px_rgba(2,6,23,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/80">Integrations</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Connect your HR stack</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              Phase 1 integrations are live. Connect an HRMS, compliance, recruitment, or finance system to unlock governed workflows and AI-ready telemetry.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
            <BadgeCheck className="h-4 w-4 text-emerald-300" />
            <span className="font-semibold">{connectedCount}</span>
            <span className="text-slate-400">connected</span>
          </div>
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {loadError}
          </div>
        ) : null}
      </header>

      <section className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(2,6,23,0.18)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="integrations-search"
              name="integrations-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search integrations, categories, or capability tags"
              autoComplete="off"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-400/40 focus:bg-white/[0.07]"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              id="integrations-phase"
              name="integrations-phase"
              value={String(phaseFilter)}
              onChange={(e) => setPhaseFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 2 | 3 | 4))}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-400/40"
            >
              <option value="all">All phases</option>
              <option value="1">Phase 1</option>
              <option value="2">Phase 2</option>
              <option value="3">Phase 3</option>
              <option value="4">Phase 4</option>
            </select>

            <select
              id="integrations-status"
              name="integrations-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-400/40"
            >
              <option value="all">All status</option>
              <option value="connected">Connected</option>
              <option value="disconnected">Disconnected</option>
              <option value="error">Error</option>
              <option value="syncing">Syncing</option>
              <option value="expired">Expired</option>
            </select>

            <select
              id="integrations-auth"
              name="integrations-auth"
              value={authFilter}
              onChange={(e) => setAuthFilter(e.target.value as any)}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-400/40"
            >
              <option value="all">All auth</option>
              <option value="api_key">API key</option>
              <option value="oauth2">OAuth2</option>
            </select>

            <select
              id="integrations-category"
              name="integrations-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-400/40"
            >
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <p>
            Showing <span className="font-semibold text-slate-200">{filteredItems.length}</span> of{' '}
            <span className="font-semibold text-slate-200">{items.length}</span> integrations.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setStatusFilter('all');
              setAuthFilter('all');
              setCategoryFilter('all');
              setPhaseFilter('all');
            }}
            className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
          >
            Reset filters
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {loading ? (
          <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
            Loading integrations...
          </div>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
            No integrations available.
          </div>
        ) : null}

        {!loading && filteredItems.length === 0 ? (
          <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
            No integrations match your filters.
          </div>
        ) : null}

        {!loading
          ? (Object.keys(groupedByPhase) as Array<'1' | '2' | '3' | '4'>).flatMap((key) => {
              const phase = Number(key) as 1 | 2 | 3 | 4;
              const list = groupedByPhase[phase];
              if (list.length === 0) return [];

              const heading = phase === 1
                ? 'Phase 1 (Critical)'
                : phase === 2
                  ? 'Phase 2 (High priority)'
                  : phase === 3
                    ? 'Phase 3 (Medium priority)'
                    : 'Phase 4 (Growing)';
              return [
                <div key={`phase-${phase}`} className="lg:col-span-2">
                  <div className="flex items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">{heading}</p>
                      <p className="mt-1 text-sm text-slate-300">{list.length} integration{list.length === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                </div>,
                ...list.map((integration) => {
                  const Icon = iconForCategory(integration.category);
                  const tone = statusTone(integration.status);
                  const label = formatStatusLabel(integration.status);
                  const isConnected = integration.status === 'connected' || integration.status === 'error' || integration.status === 'expired' || integration.status === 'syncing';
                  const isOauth = integration.authType === 'oauth2';
                  const busy = rowBusy[integration.id] || null;

                  return (
                    <article
                      key={integration.id}
                      className="flex flex-col rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.72))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.24)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          {integration.tags?.slice(0, 3).map((tag) => (
                            <span
                              key={`${integration.id}-${tag}`}
                              className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusToneClasses[tone]}`}>
                          <Shield className="h-3 w-3" />
                          {label}
                        </span>
                      </div>

                      <div className="mt-5 flex items-start gap-4">
                        <div
                          className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"
                          style={integration.color ? { color: integration.color } : undefined}
                        >
                          <Icon className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold text-white">{integration.name}</h3>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">{integration.category}</p>
                        </div>
                      </div>

                      <p className="mt-5 flex-1 text-sm leading-7 text-slate-300">{integration.description}</p>

                      {integration.lastErrorMsg ? (
                        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                          {integration.lastErrorMsg}
                        </div>
                      ) : null}

                      <div className="mt-6 flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                          <RefreshCw className="h-3.5 w-3.5" />
                          {isOauth ? 'OAuth2' : 'API Key'}
                        </span>

                        <div className="ml-auto flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void openDetails(integration)}
                            disabled={busy !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            Details
                          </button>
                          {isConnected ? (
                            <>
                              <button
                                type="button"
                                onClick={() => test(integration)}
                                disabled={busy !== null}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <RefreshCw className="h-4 w-4" />
                                {busy === 'testing' ? 'Testing...' : 'Test'}
                              </button>
                              <button
                                type="button"
                                onClick={() => disconnect(integration)}
                                disabled={busy !== null}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                {busy === 'disconnecting' ? 'Disconnecting...' : 'Disconnect'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openConnect(integration)}
                              disabled={busy !== null}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(34,211,238,0.18)] transition hover:from-cyan-400 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {integration.status === 'error' || integration.status === 'expired' ? 'Reconnect' : 'Connect'}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }),
              ];
            })
          : null}
      </section>

      {selectedIntegration ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button className="absolute inset-0 bg-slate-950/70" onClick={closeDetails} aria-label="Close details panel" />
          <aside className="relative h-full w-full max-w-[560px] overflow-y-auto border-l border-slate-700 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Integration detail</p>
                <h2 className="mt-2 text-2xl font-bold text-white">{selectedIntegration.name}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-300">{selectedIntegration.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusToneClasses[statusTone(selectedIntegration.status)]}`}>
                    {formatStatusLabel(selectedIntegration.status)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {selectedIntegration.authType === 'oauth2' ? 'OAuth2' : selectedIntegration.authType === 'api_key' ? 'API key' : selectedIntegration.authType}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                    {selectedIntegration.category}
                  </span>
                </div>
              </div>
              <button
                onClick={closeDetails}
                className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedIntegration.lastErrorMsg ? (
              <div className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                {selectedIntegration.lastErrorMsg}
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock className="h-4 w-4" />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em]">Last sync</p>
                </div>
                <p className="mt-2 text-sm text-white">
                  {selectedIntegration.lastSyncAt ? new Date(selectedIntegration.lastSyncAt).toLocaleString('en-IN') : 'Not synced yet'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <Activity className="h-4 w-4" />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em]">Connection ID</p>
                </div>
                <p className="mt-2 break-all text-sm text-white">{selectedIntegration.connectionId || 'Not connected'}</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">Connection history</p>
                {selectedIntegration.authType === 'oauth2' ? (
                  <button
                    type="button"
                    onClick={() => void refreshToken(selectedIntegration)}
                    disabled={logActionBusy !== null}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {logActionBusy === 'refreshing' ? 'Refreshing...' : 'Refresh token'}
                  </button>
                ) : null}
              </div>

              {logError ? (
                <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                  {logError}
                </div>
              ) : null}

              {logLoading ? (
                <div className="mt-4 text-sm text-slate-300">Loading history...</div>
              ) : null}

              {!logLoading && logs.length === 0 ? (
                <div className="mt-4 text-sm text-slate-300">No connection events recorded yet.</div>
              ) : null}

              {!logLoading && logs.length > 0 ? (
                <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {logs.map((log) => (
                    <div key={log.id} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                            {log.action} · {log.status}
                          </p>
                          {log.message ? (
                            <p className="mt-1 break-words text-sm text-white">{log.message}</p>
                          ) : null}
                        </div>
                        <p className="shrink-0 text-xs text-slate-400">{new Date(log.created_at).toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_35%),rgba(2,6,23,0.82)] p-6 backdrop-blur-xl">
          <div
            className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/90 shadow-[0_30px_90px_rgba(2,6,23,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="integration-connect-title"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div>
                <h2 id="integration-connect-title" className="text-lg font-semibold text-white">
                  Connect {active.name}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Add credentials for {active.name}. Secrets are stored encrypted and never re-shown after you save.
                </p>
              </div>
              <button
                type="button"
                onClick={closeConnect}
                className="rounded-xl border border-white/10 bg-white/[0.05] p-2 text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              {active.requiredFields.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                  This integration does not declare any required fields.
                </div>
              ) : (
                active.requiredFields.map((field) => {
                  const id = `${active.id}-${field.name}`;
                  const value = credentials[field.name] || '';
                  return (
                    <div key={id} className="space-y-2">
                      <label htmlFor={id} className="text-sm font-semibold text-slate-200">
                        {field.label}
                        {field.required ? <span className="text-rose-300"> *</span> : null}
                      </label>
                      <input
                        id={id}
                        name={field.name}
                        type={field.type}
                        value={value}
                        onChange={(e) => setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))}
                        placeholder={field.placeholder || ''}
                        autoComplete="off"
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-400/40 focus:bg-white/[0.07]"
                      />
                      {field.description ? (
                        <p className="text-xs text-slate-400">{field.description}</p>
                      ) : null}
                      {field.type === 'password' && value ? (
                        <p className="text-xs text-slate-500">Current input: {maskValue(value)}</p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-5">
              <button
                type="button"
                onClick={closeConnect}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void connect()}
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(34,211,238,0.18)] transition hover:from-cyan-400 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={submitting}
              >
                {submitting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
