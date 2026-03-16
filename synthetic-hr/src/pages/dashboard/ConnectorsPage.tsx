import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Gavel,
  HandCoins,
  Headset,
  Key,
  Layers,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShoppingBag,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api, type MarketplaceApp } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorsPageProps {
  onNavigate?: (page: string) => void;
  agents?: AIAgent[];
}

type ConnectorSource = 'marketplace' | 'integration';

type UnifiedConnector = {
  id: string;
  name: string;
  description: string;
  category: string;
  source: ConnectorSource;
  logoLetter: string;
  colorHex: string;
  badge?: string;
  installCount: number;
  comingSoon: boolean;
  connected: boolean;
  status: 'connected' | 'syncing' | 'error' | 'expired' | 'disconnected';
  lastErrorMsg?: string | null;
  authType: 'free' | 'api_key' | 'oauth2';
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  permissions?: string[];
  actionsUnlocked?: string[];
  setupTimeMinutes?: number;
  developer?: string;
  appData?: MarketplaceApp;
  integrationData?: any;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
  all:         { label: 'All',           Icon: ShoppingBag,      color: 'text-slate-400' },
  finance:     { label: 'Finance',       Icon: HandCoins,        color: 'text-rose-400' },
  support:     { label: 'Support',       Icon: Headset,          color: 'text-blue-400' },
  sales:       { label: 'Sales',         Icon: Building2,        color: 'text-emerald-400' },
  it:          { label: 'IT / Identity', Icon: Wrench,           color: 'text-amber-400' },
  compliance:  { label: 'Compliance',    Icon: Gavel,            color: 'text-sky-400' },
  recruitment: { label: 'Recruitment',   Icon: BriefcaseBusiness,color: 'text-violet-400' },
};

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'alpha',   label: 'A–Z' },
  { value: 'recent',  label: 'Recently added' },
];

const TYPE_OPTIONS = [
  { value: 'all',         label: 'All types' },
  { value: 'marketplace', label: 'Apps' },
  { value: 'integration', label: 'Integrations' },
];

const BADGE_STYLE: Record<string, string> = {
  Popular:          'bg-blue-500/15 border-blue-400/25 text-blue-200',
  Verified:         'bg-emerald-500/15 border-emerald-400/25 text-emerald-200',
  'India Priority': 'bg-amber-500/15 border-amber-400/25 text-amber-200',
  New:              'bg-violet-500/15 border-violet-400/25 text-violet-200',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic color from a string (for integrations without colorHex) */
function hashColor(s: string): string {
  const PALETTE = [
    '#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444',
    '#06B6D4','#EC4899','#6366F1','#84CC16','#F97316',
  ];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function integrationColor(id: string, raw?: string): string {
  if (raw && /^#[0-9a-f]{3,6}$/i.test(raw)) return raw;
  const key = id.toLowerCase();
  if (key.includes('slack'))                           return '#4A154B';
  if (key.includes('linkedin'))                        return '#0A66C2';
  if (key.includes('google') || key.includes('gmail')) return '#EA4335';
  if (key.includes('microsoft') || key.includes('teams')) return '#0078D4';
  if (key.includes('hubspot'))                         return '#FF7A59';
  if (key.includes('jira') || key.includes('atlassian')) return '#0052CC';
  if (key.includes('zendesk'))                         return '#03363D';
  if (key.includes('freshdesk'))                       return '#0070C0';
  if (key.includes('naukri'))                          return '#FF7555';
  if (key.includes('stripe'))                          return '#635BFF';
  if (key.includes('razorpay'))                        return '#2D81E0';
  if (key.includes('paytm'))                           return '#002970';
  return hashColor(id);
}

function fromApp(app: MarketplaceApp): UnifiedConnector {
  const status =
    app.connectionStatus === 'error'   ? 'error'
    : app.connectionStatus === 'expired' ? 'expired'
    : app.connectionStatus === 'syncing' ? 'syncing'
    : app.installed                      ? 'connected'
    : 'disconnected';
  return {
    id:              `app:${app.id}`,
    name:            app.name,
    description:     app.description,
    category:        app.category,
    source:          'marketplace',
    logoLetter:      app.logoLetter,
    colorHex:        app.colorHex,
    badge:           app.badge,
    installCount:    app.installCount,
    comingSoon:      !!app.comingSoon,
    connected:       !!app.installed,
    status,
    lastErrorMsg:    app.lastErrorMsg,
    authType:        app.installMethod,
    requiredFields:  app.requiredFields,
    permissions:     app.permissions,
    actionsUnlocked: app.actionsUnlocked,
    setupTimeMinutes:app.setupTimeMinutes,
    developer:       app.developer,
    appData:         app,
  };
}

function fromIntegration(row: any): UnifiedConnector {
  const rawStatus = row.lifecycleStatus || row.status || 'disconnected';
  const status =
    rawStatus === 'connected'                      ? 'connected'
    : rawStatus === 'syncing'                      ? 'syncing'
    : rawStatus === 'error'                        ? 'error'
    : rawStatus === 'expired' || row.tokenExpired  ? 'expired'
    : 'disconnected';
  return {
    id:             `int:${row.id}`,
    name:           row.name,
    description:    row.description || '',
    category:       row.category || 'it',
    source:         'integration',
    logoLetter:     (row.name || '?')[0].toUpperCase(),
    colorHex:       integrationColor(row.id, row.color),
    badge:          row.specStatus === 'COMING_SOON' ? undefined : row.badge,
    installCount:   0,
    comingSoon:     row.specStatus === 'COMING_SOON',
    connected:      status === 'connected',
    status,
    lastErrorMsg:   row.lastErrorMsg,
    authType:       row.authType === 'oauth2' ? 'oauth2' : 'api_key',
    requiredFields: row.requiredFields,
    permissions:    row.capabilities?.reads?.map((r: string) => `Read: ${r}`) || [],
    actionsUnlocked:row.capabilities?.writes?.map((w: any) => w.label) || [],
    integrationData:row,
  };
}

/** Outside-click hook for dropdown menus */
function useOutsideClick(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function listener(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    }
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConnectorLogo({
  connector,
  size = 'md',
}: {
  connector: UnifiedConnector;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'w-8 h-8 text-xs rounded-xl' : 'w-10 h-10 text-sm rounded-xl';
  return (
    <div
      className={cn('flex items-center justify-center shrink-0 font-bold text-white shadow-sm', dim)}
      style={{ backgroundColor: connector.colorHex }}
    >
      {connector.logoLetter}
    </div>
  );
}

function SetupTimePill({ minutes }: { minutes: number }) {
  const color =
    minutes <= 3 ? 'text-emerald-300 border-emerald-400/20 bg-emerald-500/10'
    : minutes <= 6 ? 'text-amber-300 border-amber-400/20 bg-amber-500/10'
    : 'text-slate-400 border-white/10 bg-white/5';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium', color)}>
      <Clock className="w-2.5 h-2.5" />~{minutes} min
    </span>
  );
}

// ─── App Connect Modal (marketplace) ─────────────────────────────────────────

function AppConnectModal({
  connector,
  mode,
  onClose,
  onDone,
}: {
  connector: UnifiedConnector;
  mode: 'connect' | 'configure';
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const app = connector.appData!;
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const res = await api.marketplace.install(app.id, credentials);
      if (!res.success) throw new Error((res as any).error || 'Failed');
      if ((res.data as any)?.oauth) {
        toast.info(`Redirecting to ${app.name} for authorization…`);
      } else {
        toast.success(mode === 'configure' ? `${app.name} credentials updated` : `${app.name} connected`);
      }
      onDone(app.id);
    } catch (err: any) {
      toast.error(err.message || 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-white/8">
          <div className="flex items-center gap-4">
            <ConnectorLogo connector={connector} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-bold text-white">{connector.name}</p>
                {connector.badge && (
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[connector.badge] || BADGE_STYLE['Verified'])}>
                    {connector.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">by {connector.developer}</p>
              <div className="flex items-center gap-2 mt-1.5">
                {connector.setupTimeMinutes != null && <SetupTimePill minutes={connector.setupTimeMinutes} />}
                <span className="text-slate-600 text-xs">·</span>
                <span className="text-xs text-slate-500">{connector.installCount.toLocaleString()} installs</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-slate-300 leading-relaxed">{connector.description}</p>

          {/* Actions unlocked */}
          {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-300" /> Actions Unlocked
              </p>
              <div className="flex flex-wrap gap-1.5">
                {connector.actionsUnlocked.map((a) => (
                  <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* Permissions */}
          {connector.permissions && connector.permissions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Shield className="w-3 h-3" /> Permissions
              </p>
              <ul className="space-y-1.5">
                {connector.permissions.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-xs text-slate-300">
                    <CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Credentials */}
          {connector.authType === 'api_key' && connector.requiredFields && connector.requiredFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Key className="w-3 h-3" /> {mode === 'configure' ? 'Update Credentials' : 'Credentials'}
              </p>
              <div className="space-y-3">
                {connector.requiredFields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-xs text-slate-400 mb-1.5">
                      {field.label}{field.required && <span className="text-rose-400 ml-0.5">*</span>}
                    </label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={credentials[field.name] || ''}
                      onChange={(e) => setCredentials((p) => ({ ...p, [field.name]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {connector.authType === 'oauth2' && (
            <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3 flex items-start gap-3">
              <ExternalLink className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                You'll be redirected to <strong className="text-white">{connector.developer}</strong> to authorize access.
              </p>
            </div>
          )}

          {connector.authType === 'free' && (
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">No credentials required — connects instantly.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-white/8">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {busy ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {mode === 'configure' ? 'Saving…' : 'Connecting…'}</>
            ) : connector.authType === 'oauth2' ? (
              <><ExternalLink className="w-4 h-4" /> Authorize with {connector.name}</>
            ) : mode === 'configure' ? (
              <><Key className="w-4 h-4" /> Update credentials</>
            ) : (
              <><Zap className="w-4 h-4" /> Connect</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Integration Connect Modal (api/oauth integrations) ───────────────────────

function IntegrationConnectModal({
  connector,
  mode,
  onClose,
  onDone,
}: {
  connector: UnifiedConnector;
  mode: 'connect' | 'configure';
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const row = connector.integrationData;
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      if (connector.authType === 'oauth2') {
        const res = await api.integrations.initOAuth(row.id, '/dashboard/connectors', {}, false);
        if (res.success && (res.data as any)?.url) {
          window.location.href = (res.data as any).url;
          return;
        }
        throw new Error((res as any).error || 'OAuth initialization failed');
      } else {
        const fn = mode === 'configure' ? api.integrations.configure : api.integrations.connect;
        const res = await fn(row.id, credentials);
        if (!res.success) throw new Error((res as any).error || 'Connection failed');
        toast.success(mode === 'configure' ? `${connector.name} credentials updated` : `${connector.name} connected`);
        onDone(connector.id);
      }
    } catch (err: any) {
      toast.error(err.message || 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-white/8">
          <div className="flex items-center gap-4">
            <ConnectorLogo connector={connector} />
            <div>
              <p className="text-base font-bold text-white">{connector.name}</p>
              <p className="text-xs text-slate-500 mt-0.5 capitalize">{connector.authType === 'oauth2' ? 'OAuth 2.0' : 'API Key'} · {connector.category}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {connector.description && (
            <p className="text-sm text-slate-300 leading-relaxed">{connector.description}</p>
          )}

          {/* Actions unlocked */}
          {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-300" /> Actions Unlocked
              </p>
              <div className="flex flex-wrap gap-1.5">
                {connector.actionsUnlocked.map((a) => (
                  <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* API key fields */}
          {connector.authType === 'api_key' && connector.requiredFields && connector.requiredFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Key className="w-3 h-3" /> {mode === 'configure' ? 'Update Credentials' : 'Credentials'}
              </p>
              <div className="space-y-3">
                {connector.requiredFields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-xs text-slate-400 mb-1.5">
                      {field.label}{field.required && <span className="text-rose-400 ml-0.5">*</span>}
                    </label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={credentials[field.name] || ''}
                      onChange={(e) => setCredentials((p) => ({ ...p, [field.name]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OAuth explanation */}
          {connector.authType === 'oauth2' && (
            <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3 flex items-start gap-3">
              <ExternalLink className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                You'll be redirected to <strong className="text-white">{connector.name}</strong> to authorize access. You'll return here automatically after.
              </p>
            </div>
          )}

          {/* Governance note */}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-start gap-3">
            <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400">
              All actions through this connector are governed by your{' '}
              <strong className="text-slate-300">Action Policies</strong> with full incident detection and audit logging.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-white/8">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {busy ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {connector.authType === 'oauth2' ? 'Redirecting…' : mode === 'configure' ? 'Saving…' : 'Connecting…'}</>
            ) : connector.authType === 'oauth2' ? (
              <><ExternalLink className="w-4 h-4" /> Authorize with {connector.name}</>
            ) : mode === 'configure' ? (
              <><Key className="w-4 h-4" /> Update credentials</>
            ) : (
              <><Zap className="w-4 h-4" /> Connect</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Browse Modal ─────────────────────────────────────────────────────────────

function BrowseModal({
  connectors,
  onClose,
  onConnect,
  onManage,
}: {
  connectors: UnifiedConnector[];
  onClose: () => void;
  onConnect: (c: UnifiedConnector) => void;
  onManage: (c: UnifiedConnector) => void;
}) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('popular');
  const [filterType, setFilterType] = useState<'all' | 'marketplace' | 'integration'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [activeDropdown, setActiveDropdown] = useState<'sort' | 'type' | 'cat' | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useOutsideClick(filtersRef, () => setActiveDropdown(null));

  const popularityMap = useMemo(() => {
    const sorted = [...connectors].sort((a, b) => b.installCount - a.installCount);
    const map: Record<string, number> = {};
    sorted.forEach((c, i) => { map[c.id] = i + 1; });
    return map;
  }, [connectors]);

  const filtered = useMemo(() => {
    let list = [...connectors];
    if (filterType !== 'all')      list = list.filter((c) => c.source === filterType);
    if (filterCategory !== 'all')  list = list.filter((c) => c.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          (c.developer || '').toLowerCase().includes(q),
      );
    }
    if (sortBy === 'alpha')  list.sort((a, b) => a.name.localeCompare(b.name));
    else                     list.sort((a, b) => b.installCount - a.installCount);
    return list;
  }, [connectors, filterType, filterCategory, search, sortBy]);

  function popLabel(c: UnifiedConnector): string | null {
    if (c.source !== 'marketplace') return null;
    const rank = popularityMap[c.id];
    if (!rank) return null;
    if (rank === 1)   return 'Most popular';
    if (rank <= 10)   return `#${rank} popular`;
    return null;
  }

  const toggle = (d: typeof activeDropdown) =>
    setActiveDropdown((prev) => (prev === d ? null : d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-white/8">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-lg font-bold text-white">Connectors</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Connect Rasi agents to your apps, files, and services. Connectors are reviewed by the Rasi
              team for security. You can also{' '}
              <button
                className="text-blue-400 hover:underline"
                onClick={() => toast.info('Custom connector support coming soon.')}
              >
                add a custom connector
              </button>.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div ref={filtersRef} className="flex items-center gap-2 px-6 py-3 border-b border-white/8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort */}
          <div className="relative">
            <button
              onClick={() => toggle('sort')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors',
                activeDropdown === 'sort'
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
              )}
            >
              Sort <ChevronDown className="w-3 h-3" />
            </button>
            {activeDropdown === 'sort' && (
              <div className="absolute top-full mt-1 right-0 w-44 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-20 overflow-hidden">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setActiveDropdown(null); }}
                    className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', sortBy === opt.value ? 'text-white font-medium' : 'text-slate-400')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Type */}
          <div className="relative">
            <button
              onClick={() => toggle('type')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors',
                activeDropdown === 'type' || filterType !== 'all'
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
              )}
            >
              Type <ChevronDown className="w-3 h-3" />
            </button>
            {activeDropdown === 'type' && (
              <div className="absolute top-full mt-1 right-0 w-44 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-20 overflow-hidden">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setFilterType(opt.value as any); setActiveDropdown(null); }}
                    className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', filterType === opt.value ? 'text-white font-medium' : 'text-slate-400')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Categories */}
          <div className="relative">
            <button
              onClick={() => toggle('cat')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors',
                activeDropdown === 'cat' || filterCategory !== 'all'
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
              )}
            >
              Categories <ChevronDown className="w-3 h-3" />
            </button>
            {activeDropdown === 'cat' && (
              <div className="absolute top-full mt-1 right-0 w-48 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-20 overflow-hidden">
                {Object.entries(CATEGORY_META).map(([key, { label, Icon, color }]) => (
                  <button
                    key={key}
                    onClick={() => { setFilterCategory(key); setActiveDropdown(null); }}
                    className={cn('w-full text-left px-3.5 py-2.5 text-xs flex items-center gap-2.5 hover:bg-white/5 transition-colors', filterCategory === key ? 'text-white font-medium' : 'text-slate-400')}
                  >
                    <Icon className={cn('w-3.5 h-3.5', color)} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="overflow-y-auto flex-1 p-4">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No connectors found{search ? ` for "${search}"` : ''}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((c) => {
                const pl = popLabel(c);
                const isConnected = c.connected;
                return (
                  <button
                    key={c.id}
                    disabled={c.comingSoon}
                    onClick={() => {
                      if (c.comingSoon) return;
                      if (isConnected) { onManage(c); } else { onConnect(c); }
                    }}
                    className={cn(
                      'group text-left rounded-2xl border p-4 flex items-start gap-3 transition-all',
                      c.comingSoon
                        ? 'border-white/5 bg-white/[0.01] opacity-50 cursor-default'
                        : isConnected
                          ? 'border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07] cursor-pointer'
                          : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 cursor-pointer',
                    )}
                  >
                    <ConnectorLogo connector={c} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white leading-tight truncate">{c.name}</p>
                          {pl && <p className="text-[10px] text-slate-500 mt-0.5">{pl}</p>}
                          {/* badge (Popular, Verified, India Priority, New) */}
                          {c.badge && !pl && (
                            <p className="text-[10px] text-slate-500 mt-0.5">{c.badge}</p>
                          )}
                        </div>
                        {c.comingSoon ? (
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-700/20 text-slate-500 font-medium">Soon</span>
                        ) : isConnected ? (
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/25 bg-emerald-500/15 text-emerald-300 font-medium">Connected</span>
                        ) : c.badge ? (
                          <span className={cn('shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[c.badge] || BADGE_STYLE['Verified'])}>{c.badge}</span>
                        ) : (
                          <span className="shrink-0 w-6 h-6 rounded-lg border border-white/10 bg-white/[0.04] group-hover:bg-white/[0.12] group-hover:border-white/20 flex items-center justify-center transition-all">
                            <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{c.description}</p>
                      {/* source label */}
                      <p className="text-[10px] text-slate-600 mt-1.5">{c.source === 'marketplace' ? 'App' : 'Integration'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Connected Connector Row ──────────────────────────────────────────────────

function ConnectorRow({
  connector,
  agentNames,
  onConfigure,
  onDisconnect,
}: {
  connector: UnifiedConnector;
  agentNames: string[];
  onConfigure: (c: UnifiedConnector) => void;
  onDisconnect: (c: UnifiedConnector) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClick(menuRef, () => setShowMenu(false));

  const hasError = connector.status === 'error' || connector.status === 'expired';

  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <ConnectorLogo connector={connector} size="sm" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white leading-tight">{connector.name}</p>
          {/* Source tag */}
          <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-500 font-medium">
            {connector.source === 'marketplace' ? 'App' : 'Integration'}
          </span>
        </div>

        {/* Agent association */}
        {agentNames.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <Bot className="w-3 h-3 text-slate-500 shrink-0" />
            <p className="text-[11px] text-slate-500 truncate">
              {agentNames.slice(0, 3).join(', ')}{agentNames.length > 3 ? ` +${agentNames.length - 3}` : ''}
            </p>
          </div>
        )}

        {/* Error message */}
        {connector.lastErrorMsg && (
          <p className="text-[11px] text-rose-400 mt-0.5 truncate">{connector.lastErrorMsg}</p>
        )}
      </div>

      {/* Actions unlocked count */}
      {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && !hasError && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="text-xs text-slate-500">{connector.actionsUnlocked.length} actions</span>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {hasError ? (
          <button
            onClick={() => onConfigure(connector)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 text-rose-300 text-xs font-medium hover:bg-rose-500/20 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5" /> Reconnect
          </button>
        ) : connector.status === 'syncing' ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-xl border border-amber-400/20 bg-amber-500/10">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing
          </span>
        ) : (
          <span className="text-sm font-medium text-emerald-400">Connected</span>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute top-full mt-1 right-0 w-44 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-10 overflow-hidden">
              <button
                onClick={() => { onConfigure(connector); setShowMenu(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                {connector.authType === 'oauth2' ? 'Reauthorize' : 'Update credentials'}
              </button>
              <button
                onClick={() => { onDisconnect(connector); setShowMenu(false); }}
                className="w-full text-left px-3.5 py-2.5 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConnectorsPage({ onNavigate, agents = [] }: ConnectorsPageProps) {
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBrowse, setShowBrowse] = useState(false);
  const [modalTarget, setModalTarget] = useState<{ connector: UnifiedConnector; mode: 'connect' | 'configure' } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, intsRes] = await Promise.all([
        api.marketplace.getAll(),
        api.integrations.getAll(),
      ]);
      if (appsRes.success && Array.isArray(appsRes.data)) setApps(appsRes.data);
      if (intsRes.success && Array.isArray(intsRes.data)) setIntegrations(intsRes.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Merge both sources into unified connectors
  const allConnectors = useMemo<UnifiedConnector[]>(() => [
    ...apps.map(fromApp),
    ...integrations.map(fromIntegration),
  ], [apps, integrations]);

  const connectedList = useMemo(
    () => allConnectors.filter((c) => c.connected),
    [allConnectors],
  );

  // Build agent name map per connector
  const agentNamesFor = useCallback((connector: UnifiedConnector): string[] => {
    if (connector.source === 'marketplace' && connector.appData) {
      const relIds = new Set(connector.appData.relatedAgentIds);
      return agents.filter((a) => relIds.has(a.id)).map((a) => a.name);
    }
    if (connector.source === 'integration') {
      const svcId = connector.integrationData?.id;
      return agents.filter((a) => a.integrationIds?.includes(svcId)).map((a) => a.name);
    }
    return [];
  }, [agents]);

  // Handle connect/configure modal
  const openModal = (connector: UnifiedConnector, mode: 'connect' | 'configure') =>
    setModalTarget({ connector, mode });

  const handleConnected = (connectorId: string) => {
    // Update local state optimistically
    setApps((prev) =>
      prev.map((a) => (connectorId === `app:${a.id}` ? { ...a, installed: true } : a)),
    );
    setIntegrations((prev) =>
      prev.map((i) => (connectorId === `int:${i.id}` ? { ...i, lifecycleStatus: 'connected', status: 'connected' } : i)),
    );
    setModalTarget(null);
    setShowBrowse(false);
  };

  const handleDisconnect = async (connector: UnifiedConnector) => {
    try {
      if (connector.source === 'marketplace') {
        const res = await api.marketplace.uninstall(connector.appData!.id);
        if (!res.success) throw new Error((res as any).error || 'Disconnect failed');
        setApps((prev) => prev.map((a) => (a.id === connector.appData!.id ? { ...a, installed: false } : a)));
      } else {
        const res = await api.integrations.disconnect(connector.integrationData.id);
        if (!res.success) throw new Error((res as any).error || 'Disconnect failed');
        setIntegrations((prev) =>
          prev.map((i) => (i.id === connector.integrationData.id ? { ...i, lifecycleStatus: 'disconnected', status: 'disconnected' } : i)),
        );
      }
      toast.success(`${connector.name} disconnected`);
    } catch (err: any) {
      toast.error(err.message || 'Disconnect failed');
    }
  };

  const totalActions = connectedList.reduce((sum, c) => sum + (c.actionsUnlocked?.length || 0), 0);
  const errorCount = connectedList.filter((c) => c.status === 'error' || c.status === 'expired').length;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Connectors</h1>
          <p className="text-slate-400 text-sm mt-1">
            Allow your agents to reference other apps and services for more context.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void loadData()}
            className="p-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowBrowse(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-sm font-medium transition-colors"
          >
            Browse connectors
          </button>
        </div>
      </div>

      {/* Stats bar (only when connected) */}
      {!loading && connectedList.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className={cn('rounded-xl border p-3 text-center', errorCount > 0 ? 'border-rose-400/15 bg-rose-500/[0.04]' : 'border-emerald-400/15 bg-emerald-500/[0.04]')}>
            <p className={cn('text-xl font-bold', errorCount > 0 ? 'text-rose-300' : 'text-emerald-300')}>{connectedList.length - errorCount}/{connectedList.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{errorCount > 0 ? `${errorCount} need attention` : 'All healthy'}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
            <p className="text-xl font-bold text-white">{totalActions}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Actions unlocked</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
            <p className="text-xl font-bold text-white">
              {new Set(connectedList.flatMap((c) => agentNamesFor(c))).size}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Agents powered</p>
          </div>
        </div>
      )}

      {/* Connected list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        </div>
      ) : connectedList.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm font-semibold text-white mb-1.5">No connectors yet</p>
          <p className="text-xs text-slate-400 mb-5 max-w-xs mx-auto">
            Browse and connect apps and integrations so your agents can take action with full governance.
          </p>
          <button
            onClick={() => setShowBrowse(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
          >
            Browse connectors
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {connectedList.map((c) => (
            <ConnectorRow
              key={c.id}
              connector={c}
              agentNames={agentNamesFor(c)}
              onConfigure={(connector) => openModal(connector, 'configure')}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => toast.info('Custom connector support coming soon.')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-white/15 text-slate-400 hover:text-white hover:border-white/25 text-sm font-medium transition-colors w-fit"
          >
            <Plus className="w-4 h-4" /> Add custom connector
          </button>
          <button
            onClick={() => onNavigate?.('integrations')}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors text-left"
          >
            Manage advanced integrations →
          </button>
        </div>
      )}

      {/* Browse Modal */}
      {showBrowse && (
        <BrowseModal
          connectors={allConnectors}
          onClose={() => setShowBrowse(false)}
          onConnect={(c) => { setShowBrowse(false); openModal(c, 'connect'); }}
          onManage={(c) => { setShowBrowse(false); openModal(c, 'configure'); }}
        />
      )}

      {/* Connect / Configure Modal */}
      {modalTarget && (
        modalTarget.connector.source === 'marketplace' ? (
          <AppConnectModal
            connector={modalTarget.connector}
            mode={modalTarget.mode}
            onClose={() => setModalTarget(null)}
            onDone={handleConnected}
          />
        ) : (
          <IntegrationConnectModal
            connector={modalTarget.connector}
            mode={modalTarget.mode}
            onClose={() => setModalTarget(null)}
            onDone={handleConnected}
          />
        )
      )}
    </div>
  );
}
