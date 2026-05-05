import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Fuse from 'fuse.js';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Loader2, ChevronDown, X, ExternalLink,
  Search, CheckCircle2, AlertCircle, Clock, ArrowRight, RefreshCw,
  Shield, BarChart3, Zap, GitCompare,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';
import { useAppsData } from './hooks/useAppsData';
import { getAppServiceId } from './helpers';
import { isCertifiedProductionConnector, deriveConnectorCertification, type ReadinessStatus } from '../../../lib/production-readiness';
import { ConnectWizard } from './connect-wizard/ConnectWizard';
import { IntentPicker } from './components/IntentPicker';
import { AppCard, type ConnStatus } from './components/AppCard';
import { StackCard } from './components/StackCard';
import { StackWizard } from './components/StackWizard';
import type { UnifiedApp } from './types';
import type { AuthType, ProductionStatus, CredField, AppDef, AppStack } from './data/catalog';
import { APP_CATALOG, CATEGORY_TABS, STACKS, INDIA_POPULAR_IDS } from './data/catalog';
import { AppCardSkeleton } from './components/AppCardSkeleton';
import { RequestAccessModal } from './components/RequestAccessModal';
import { fireConfetti } from '../../../lib/confetti';

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

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

/* Bridge AppDef → UnifiedApp so ConnectWizard can receive it */
function appDefToUnifiedApp(def: AppDef, backendUnified?: UnifiedApp | null): UnifiedApp {
  if (backendUnified) return backendUnified;
  const certification = deriveConnectorCertification({
    connectorId: def.appId,
    comingSoon: def.productionStatus === 'coming_soon',
    connected: false,
    status: 'disconnected',
  });
  const readinessStatus: ReadinessStatus = def.productionStatus === 'coming_soon'
    ? 'blocked'
    : 'not_configured';
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
    readinessStatus,
    connectorCertification: certification,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────────────────────── */

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

export default function AppsPage({ agents = [], onNavigate }: AppsPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [requestApp, setRequestApp] = useState<AppDef | null>(null);
  const [stackFilter, setStackFilter] = useState<string[] | null>(null);
  const [activeWizard, setActiveWizard] = useState<AppStack | null>(null);
  const [wizardApp, setWizardApp] = useState<{ def: AppDef; unified: UnifiedApp } | null>(null);

  const { allApps, loading, reload, markConnected, markDisconnected } = useAppsData(agents);
  const hasEverConnected = useRef(false);

  // Capture the just-connected service at mount time (before setSearchParams wipes the URL).
  // This ref persists for the component lifetime and acts as a guaranteed fallback when the
  // first API response races against the URL-param cleanup in the OAuth callback effect.
  const justConnectedService = useRef<string | null>((() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const svc = p.get('service') || p.get('provider');
      return (svc && p.get('status') === 'connected') ? svc : null;
    } catch { return null; }
  })());

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
        markConnected(service);
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
  }, [searchParams, setSearchParams, reload, markConnected, onNavigate]);

  // Merge backend status
  const apps = useMemo(() => APP_CATALOG.map((def) => {
    const backendUnified = allApps.find((a) => {
      const sid = getAppServiceId(a);
      return a.appId === def.appId || sid === def.serviceId;
    }) ?? null;
    let status = resolveStatus(def, backendUnified);
    // If this service just completed OAuth (read at mount time, before URL params were cleared),
    // force it to "connected" so the card flips immediately regardless of API timing.
    const jcs = justConnectedService.current;
    if (status !== 'connected' && jcs && (def.serviceId === jcs || def.appId === jcs)) {
      status = 'connected';
    }
    return { def, status, backendApp: backendUnified, backendUnified };
  }), [allApps]);

  // Fuse.js instance — rebuilt only when apps list changes
  const fuse = useMemo(() => new Fuse(apps, {
    keys: [
      { name: 'def.name', weight: 3 },
      { name: 'def.description', weight: 1 },
      { name: 'def.category', weight: 1 },
      { name: 'def.tags', weight: 0.5 },
    ],
    threshold: 0.35,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [apps]);

  // Matched term indices per appId for highlighting
  const [matchMap, setMatchMap] = useState<Record<string, string[]>>({});

  const filtered = useMemo(() => {
    let list = apps;
    if (stackFilter) list = list.filter(({ def }) => stackFilter.includes(def.appId));
    else if (activeCategory !== 'all') list = list.filter(({ def }) => def.category === activeCategory);

    if (search.trim()) {
      const results = fuse.search(search);
      const appIdOrder = new Map(results.map((r, i) => [r.item.def.appId, i]));
      // Build match map for highlighting
      const mm: Record<string, string[]> = {};
      for (const r of results) {
        const terms: string[] = [];
        for (const m of r.matches ?? []) {
          for (const [start, end] of m.indices) {
            if (end - start >= 1) terms.push((m.value ?? '').slice(start, end + 1));
          }
        }
        mm[r.item.def.appId] = terms;
      }
      setMatchMap(mm);
      list = results.map((r) => r.item).filter((item) => list.some(({ def }) => def.appId === item.def.appId));
      return list.sort((a, b) => (appIdOrder.get(a.def.appId) ?? 999) - (appIdOrder.get(b.def.appId) ?? 999));
    }

    setMatchMap({});
    // India-native apps sort to top within category
    return [...list].sort((a, b) => {
      if (a.def.isIndiaNative && !b.def.isIndiaNative) return -1;
      if (!a.def.isIndiaNative && b.def.isIndiaNative) return 1;
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (a.status !== 'connected' && b.status === 'connected') return 1;
      return 0;
    });
  }, [apps, activeCategory, search, stackFilter, fuse]);

  // Keyboard navigation cursor for search results
  const [cursor, setCursor] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const appCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Reset cursor when search changes
  useEffect(() => { setCursor(-1); }, [search]);

  // Keyboard navigation for search results
  useEffect(() => {
    if (!search.trim()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && cursor >= 0) {
        const item = filtered[cursor];
        if (item) {
          const el = appCardRefs.current[item.def.appId];
          el?.querySelector('button')?.click();
        }
      } else if (e.key === 'Escape') {
        setSearch('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search, cursor, filtered]);

  // Scroll focused card into view
  useEffect(() => {
    if (cursor < 0) return;
    const item = filtered[cursor];
    if (item) appCardRefs.current[item.def.appId]?.scrollIntoView({ block: 'nearest' });
  }, [cursor, filtered]);

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
  const certifiedPathCount = useMemo(() => APP_CATALOG.filter((a) => isCertifiedProductionConnector(a.appId)).length, []);

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
    if (!hasEverConnected.current) {
      hasEverConnected.current = true;
      fireConfetti();
    }
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

        {/* Quick-access links */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate('/dashboard/apps/permissions')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-300 text-xs font-medium hover:bg-violet-500/20 transition-colors"
          >
            <Shield className="w-3.5 h-3.5" /> Permission Matrix
          </button>
          <button
            onClick={() => navigate('/dashboard/apps/analytics')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-300 text-xs font-medium hover:bg-blue-500/20 transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5" /> Analytics
          </button>
          <button
            onClick={() => navigate('/dashboard/apps/build-stack')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" /> Build Your Stack
          </button>
          <button
            onClick={() => navigate('/dashboard/apps/compare')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-500/25 bg-slate-500/10 text-slate-300 text-xs font-medium hover:bg-slate-500/20 transition-colors"
          >
            <GitCompare className="w-3.5 h-3.5" /> Compare
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            { label: 'Connected', value: connected.length, color: 'text-emerald-400' },
            { label: 'Certified paths', value: certifiedPathCount, color: 'text-blue-400' },
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
            ref={searchInputRef}
            type="text"
            placeholder="Search 150+ apps by name or category…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setStackFilter(null); }}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault(); }}
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
                    <p className="text-[10px] text-slate-500">{status === 'connected' ? '✓ Connected' : isCertifiedProductionConnector(def.appId) ? 'Certified path' : 'Not certified yet'}</p>
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

        {/* Your Apps — personalized landing strip for returning users */}
        {connected.length > 0 && !search && !stackFilter && (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-xs font-bold text-white uppercase tracking-widest">Your Apps</p>
              <span className="text-xs text-emerald-400 font-medium">{connected.length} connected</span>
              {needsAttention.length > 0 && (
                <span className="text-xs text-amber-400">· {needsAttention.length} need{needsAttention.length === 1 ? 's' : ''} attention</span>
              )}
            </div>
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

        {/* Intent picker — between Your Apps and Browse for returning users; top for new users */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <IntentPicker onSelect={(bundleId) => {
            const stack = STACKS.find((s) => s.id === bundleId);
            if (stack) { setActiveWizard(stack); } else { setSearch(bundleId); }
          }} />
        )}

        {/* Browse all apps divider — shown when user has connected apps */}
        {connected.length > 0 && !search && !stackFilter && activeCategory === 'all' && (
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest shrink-0">Browse all apps</p>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
        )}

        {/* Category tabs — horizontal scroll on mobile with fade gradient */}
        {!stackFilter && (
          <div className="relative">
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
              {CATEGORY_TABS.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0',
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
            {/* Right fade gradient — only shown on mobile */}
            <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-[#0a0f1a] to-transparent sm:hidden" />
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
            {/* Recently connected — shown at top of search results */}
            {search.trim() && connected.length > 0 && (() => {
              const recentlyConnected = filtered.filter(({ status }) => status === 'connected');
              if (recentlyConnected.length === 0) return null;
              return (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">Recently connected</p>
                  <div className="space-y-2">
                    {recentlyConnected.map(({ def, status, backendApp, backendUnified }, idx) => (
                      <div
                        key={def.appId}
                        ref={(el) => { appCardRefs.current[def.appId] = el; }}
                        className={cn('rounded-2xl transition-colors', cursor === idx && 'ring-1 ring-blue-500/50 bg-blue-500/5')}
                      >
                        <AppCard
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
                          highlightTerms={matchMap[def.appId]}
                        />
                      </div>
                    ))}
                  </div>
                  {filtered.filter(({ status }) => status !== 'connected').length > 0 && (
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-2 px-1">All results</p>
                  )}
                </div>
              );
            })()}
            {filtered.filter(({ status }) => !search.trim() || status !== 'connected').map(({ def, status, backendApp, backendUnified }, idx) => {
              const globalIdx = search.trim() ? connected.filter(({ status: s }) => s === 'connected').length + idx : idx;
              return (
                <div
                  key={def.appId}
                  ref={(el) => { appCardRefs.current[def.appId] = el; }}
                  className={cn('rounded-2xl transition-colors card-fadein', cursor === globalIdx && 'ring-1 ring-blue-500/50 bg-blue-500/5')}
                  style={{ animationDelay: `${Math.min(idx, 20) * 30}ms` }}
                >
                  <AppCard
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
                    highlightTerms={search.trim() ? matchMap[def.appId] : undefined}
                  />
                </div>
              );
            })}
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
