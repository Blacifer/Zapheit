import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Gavel,
  HandCoins,
  Headset,
  Key,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api, type MarketplaceApp, type AppBundle } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';

interface MarketplacePageProps {
  onNavigate?: (page: string) => void;
  agents?: AIAgent[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  all:         { label: 'All Apps',       Icon: ShoppingBag,      color: 'text-slate-300',   bg: 'bg-slate-500/15' },
  finance:     { label: 'Finance',        Icon: HandCoins,         color: 'text-rose-300',    bg: 'bg-rose-500/15' },
  support:     { label: 'Support',        Icon: Headset,           color: 'text-blue-300',    bg: 'bg-blue-500/15' },
  sales:       { label: 'Sales',          Icon: Building2,         color: 'text-emerald-300', bg: 'bg-emerald-500/15' },
  it:          { label: 'IT / Identity',  Icon: Wrench,            color: 'text-amber-300',   bg: 'bg-amber-500/15' },
  compliance:  { label: 'Compliance',     Icon: Gavel,             color: 'text-sky-300',     bg: 'bg-sky-500/15' },
  recruitment: { label: 'Recruitment',    Icon: BriefcaseBusiness, color: 'text-violet-300',  bg: 'bg-violet-500/15' },
};

const BADGE_STYLE: Record<string, string> = {
  Popular:        'bg-blue-500/15 border-blue-400/25 text-blue-200',
  Verified:       'bg-emerald-500/15 border-emerald-400/25 text-emerald-200',
  'India Priority': 'bg-amber-500/15 border-amber-400/25 text-amber-200',
  New:            'bg-violet-500/15 border-violet-400/25 text-violet-200',
};

const BUNDLE_ICONS: Record<string, React.ElementType> = {
  BriefcaseBusiness, Building2, HandCoins, Headset, Wrench, Gavel,
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function SetupTimePill({ minutes }: { minutes: number }) {
  const label = minutes < 5 ? `~${minutes} min` : `~${minutes} min`;
  const color = minutes <= 3 ? 'text-emerald-300 border-emerald-400/20 bg-emerald-500/10'
    : minutes <= 6 ? 'text-amber-300 border-amber-400/20 bg-amber-500/10'
    : 'text-slate-400 border-white/10 bg-white/5';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium', color)}>
      <Clock className="w-2.5 h-2.5" />{label}
    </span>
  );
}

function AppLogo({ app, size = 'md' }: { app: MarketplaceApp; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-8 h-8 text-sm rounded-xl' : size === 'lg' ? 'w-14 h-14 text-xl rounded-2xl' : 'w-10 h-10 text-base rounded-xl';
  return (
    <div className={cn('flex items-center justify-center shrink-0 text-white font-bold shadow-sm', dim)} style={{ backgroundColor: app.colorHex }}>
      {app.logoLetter}
    </div>
  );
}

// ─── Install Modal ────────────────────────────────────────────────────────────

function InstallModal({ app, onClose, onInstalled }: { app: MarketplaceApp; onClose: () => void; onInstalled: (id: string) => void }) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const res = await api.marketplace.install(app.id, credentials);
      if (!res.success) throw new Error((res as any).error || 'Install failed');
      if ((res.data as any)?.oauth) {
        toast.info(`OAuth flow for ${app.name} — opening authorization…`);
      } else {
        toast.success(`${app.name} added to your workspace`);
      }
      onInstalled(app.id);
    } catch (err: any) {
      toast.error(err.message || 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/8">
          <div className="flex items-center gap-4">
            <AppLogo app={app} size="lg" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-bold text-white">{app.name}</p>
                {app.badge && (
                  <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[app.badge] || BADGE_STYLE['Verified'])}>
                    {app.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">by {app.developer}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <SetupTimePill minutes={app.setupTimeMinutes} />
                <span className="text-slate-600 text-xs">·</span>
                <span className="text-xs text-slate-500">{app.installCount.toLocaleString()} installs</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
          <p className="text-sm text-slate-300 leading-relaxed">{app.description}</p>

          {/* Actions unlocked */}
          {app.actionsUnlocked?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-300" /> Actions This Unlocks
              </p>
              <div className="flex flex-wrap gap-1.5">
                {app.actionsUnlocked.map((a) => (
                  <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>
                ))}
              </div>
            </div>
          )}

          {/* Related agents */}
          {app.relatedAgentIds.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Bot className="w-3 h-3 text-blue-300" /> Powers These Agents
              </p>
              <div className="flex flex-wrap gap-1.5">
                {app.relatedAgentIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-200">
                    <Bot className="w-3 h-3" />
                    {id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Permissions */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Permissions Requested
            </p>
            <ul className="space-y-1.5">
              {app.permissions.map((p) => (
                <li key={p} className="flex items-start gap-2 text-xs text-slate-300">
                  <CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}
                </li>
              ))}
            </ul>
          </div>

          {/* Credentials form */}
          {app.installMethod === 'api_key' && app.requiredFields && app.requiredFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Key className="w-3 h-3" /> Credentials
              </p>
              <div className="space-y-3">
                {app.requiredFields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-xs text-slate-400 mb-1.5">
                      {field.label}{field.required && <span className="text-rose-400 ml-0.5">*</span>}
                    </label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={credentials[field.name] || ''}
                      onChange={(e) => setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {app.installMethod === 'oauth2' && (
            <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3 flex items-start gap-3">
              <ExternalLink className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                You'll be redirected to <strong className="text-white">{app.developer}</strong> to authorize access.
              </p>
            </div>
          )}
          {app.installMethod === 'free' && (
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">No credentials required — installs instantly.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-white/8">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {installing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
            ) : app.installMethod === 'oauth2' ? (
              <><ExternalLink className="w-4 h-4" /> Connect with {app.name}</>
            ) : (
              <><Zap className="w-4 h-4" /> Add App</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App Card ─────────────────────────────────────────────────────────────────

function AppCard({ app, onInstall, onUninstall, onNavigate, agentNames }: {
  app: MarketplaceApp;
  onInstall: (app: MarketplaceApp) => void;
  onUninstall: (app: MarketplaceApp) => void;
  onNavigate?: (page: string) => void;
  agentNames?: string[];
}) {
  const [uninstalling, setUninstalling] = useState(false);
  const catMeta = CATEGORY_META[app.category] || CATEGORY_META['all'];
  const { Icon: CatIcon, color: catColor } = catMeta;
  const viaConnections = app.installed && app.connectionSource === 'connections';

  const handleUninstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setUninstalling(true);
    try {
      const res = await api.marketplace.uninstall(app.id);
      if (!res.success) throw new Error((res as any).error || 'Remove failed');
      toast.success(`${app.name} removed`);
      onUninstall(app);
    } catch (err: any) {
      toast.error(err.message || 'Remove failed');
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <div
      className={cn(
        'group rounded-2xl border p-4 flex flex-col gap-3.5 transition-all',
        app.comingSoon
          ? 'border-white/5 bg-white/[0.015] opacity-60 cursor-default'
          : app.installed
            ? 'border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06] cursor-pointer'
            : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 cursor-pointer',
      )}
      onClick={() => !app.installed && !app.comingSoon && onInstall(app)}
    >
      {/* Top */}
      <div className="flex items-start gap-3">
        <AppLogo app={app} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold text-white leading-tight">{app.name}</p>
            {app.comingSoon && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-600/40 bg-slate-700/20 text-slate-500 font-medium">
                Coming Soon
              </span>
            )}
            {!app.comingSoon && app.badge && !app.installed && (
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border font-medium', BADGE_STYLE[app.badge] || BADGE_STYLE['Verified'])}>
                {app.badge}
              </span>
            )}
            {app.installed && !app.comingSoon && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-500/15 border-emerald-400/25 text-emerald-300 font-medium flex items-center gap-0.5">
                <CheckCircle2 className="w-2.5 h-2.5" /> Added
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <CatIcon className={cn('w-3 h-3', catColor)} />
            <span className={cn('text-[11px] font-medium', catColor)}>{catMeta.label}</span>
          </div>
        </div>
        <SetupTimePill minutes={app.setupTimeMinutes} />
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{app.description}</p>

      {/* Actions unlocked */}
      {!app.comingSoon && app.actionsUnlocked?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {app.actionsUnlocked.slice(0, 3).map((a) => (
            <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-md border border-amber-400/15 bg-amber-500/8 text-amber-300/80">{a}</span>
          ))}
          {app.actionsUnlocked.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/8 text-slate-500">+{app.actionsUnlocked.length - 3} more</span>
          )}
        </div>
      )}

      {/* Workspace agent match */}
      {!app.comingSoon && agentNames && agentNames.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-violet-300 shrink-0" />
          <span className="text-[11px] text-violet-300">Enhances: {agentNames.slice(0, 2).join(', ')}</span>
        </div>
      )}

      {/* Footer action */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/5 mt-auto">
        {app.comingSoon ? (
          <button
            disabled
            className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-white/5 bg-white/[0.02] text-slate-600 cursor-not-allowed"
          >
            <Bell className="w-3 h-3" /> Notify Me
          </button>
        ) : viaConnections ? (
          <>
            <span className="flex-1 text-xs text-slate-500 flex items-center gap-1">
              <Link2 className="w-3 h-3 text-blue-400" /> Connected via Integrations
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate?.('integrations'); }}
              className="text-xs text-blue-400 hover:text-blue-200 transition-colors flex items-center gap-1"
            >
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </>
        ) : app.installed ? (
          <>
            <span className="flex-1 text-xs text-slate-500 flex items-center gap-1">
              <Zap className="w-3 h-3 text-emerald-400" /> Active in workspace
            </span>
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              className="text-xs text-slate-600 hover:text-rose-300 transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              {uninstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              Remove
            </button>
          </>
        ) : (
          <span className="flex items-center gap-1 text-xs text-slate-500 group-hover:text-blue-300 transition-colors ml-auto">
            Add app <ChevronRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

// ─── My Apps Card ─────────────────────────────────────────────────────────────

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function HealthBadge({ app }: { app: MarketplaceApp }) {
  const status = app.connectionStatus;
  const hasError = status === 'error' || Boolean(app.lastErrorMsg);
  const isExpired = status === 'expired';
  const isSyncing = status === 'syncing';

  if (hasError || isExpired) {
    return (
      <span className="flex items-center gap-1 text-xs text-rose-300">
        <AlertTriangle className="w-3 h-3" />
        {isExpired ? 'Token expired' : 'Error'}
      </span>
    );
  }
  if (isSyncing) {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-300">
        <Loader2 className="w-3 h-3 animate-spin" /> Syncing
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> Connected
    </span>
  );
}

function MyAppCard({ app, onRemove, agentNames }: {
  app: MarketplaceApp;
  onRemove: (app: MarketplaceApp) => void;
  agentNames?: string[];
}) {
  const [removing, setRemoving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const catMeta = CATEGORY_META[app.category] || CATEGORY_META['all'];
  const hasError = app.connectionStatus === 'error' || Boolean(app.lastErrorMsg);
  const isExpired = app.connectionStatus === 'expired';
  const needsAttention = hasError || isExpired;

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await api.marketplace.uninstall(app.id);
      if (!res.success) throw new Error((res as any).error || 'Remove failed');
      toast.success(`${app.name} removed`);
      onRemove(app);
    } catch (err: any) {
      toast.error(err.message || 'Remove failed');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={cn(
      'rounded-2xl border p-4 transition-colors',
      needsAttention
        ? 'border-rose-500/20 bg-rose-500/[0.03]'
        : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.04]',
    )}>
      <div className="flex items-center gap-4">
        <AppLogo app={app} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{app.name}</p>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', catMeta.color, catMeta.bg)}>
              {catMeta.label}
            </span>
            {needsAttention && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-rose-400/25 bg-rose-500/15 text-rose-300 font-medium">
                Needs attention
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <HealthBadge app={app} />
            {app.lastSyncAt && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Clock className="w-3 h-3" /> {formatTimeAgo(app.lastSyncAt)}
              </span>
            )}
            {agentNames && agentNames.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Bot className="w-3 h-3" /> {agentNames.join(', ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {needsAttention && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-rose-400/20 bg-rose-500/10 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors"
            >
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
          <button
            onClick={handleRemove}
            disabled={removing}
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-400 hover:text-rose-300 hover:border-rose-400/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            Remove
          </button>
        </div>
      </div>

      {/* Error detail panel */}
      {expanded && app.lastErrorMsg && (
        <div className="mt-3 rounded-xl border border-rose-400/15 bg-rose-500/[0.05] px-4 py-3">
          <p className="text-xs font-semibold text-rose-300 mb-1">Last error</p>
          <p className="text-xs text-slate-300 font-mono">{app.lastErrorMsg}</p>
          {app.lastErrorAt && (
            <p className="text-[10px] text-slate-500 mt-1">{new Date(app.lastErrorAt).toLocaleString()}</p>
          )}
        </div>
      )}
      {expanded && isExpired && !app.lastErrorMsg && (
        <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.05] px-4 py-3">
          <p className="text-xs text-amber-200">OAuth token has expired. Re-connect from the App Store to refresh it.</p>
        </div>
      )}
    </div>
  );
}

// ─── Bundle Card ─────────────────────────────────────────────────────────────

function BundleCard({ bundle, apps, onInstallAll }: { bundle: AppBundle; apps: MarketplaceApp[]; onInstallAll: (bundle: AppBundle) => void }) {
  const BundleIcon = BUNDLE_ICONS[bundle.icon] || Layers;
  const bundleApps = apps.filter((a) => bundle.appIds.includes(a.id));
  const allInstalled = bundleApps.length > 0 && bundleApps.every((a) => a.installed);
  const installedCount = bundleApps.filter((a) => a.installed).length;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 flex flex-col gap-4 min-w-[280px] max-w-[340px] shrink-0">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: bundle.colorHex + '25', border: `1px solid ${bundle.colorHex}40` }}>
          <BundleIcon className="w-5 h-5" style={{ color: bundle.colorHex }} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{bundle.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{bundle.description}</p>
        </div>
      </div>

      {/* App logos */}
      <div className="flex items-center gap-2">
        {bundleApps.map((app) => (
          <div
            key={app.id}
            title={app.name}
            className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 relative', app.installed && 'ring-2 ring-emerald-400/40')}
            style={{ backgroundColor: app.colorHex }}
          >
            {app.logoLetter}
            {app.installed && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-slate-900 flex items-center justify-center">
                <CheckCircle2 className="w-1.5 h-1.5 text-slate-900" />
              </div>
            )}
          </div>
        ))}
        <span className="text-xs text-slate-500 ml-1">{bundleApps.length} apps</span>
      </div>

      {/* CTA */}
      {allInstalled ? (
        <div className="flex items-center gap-2 text-xs text-emerald-300 font-medium">
          <CheckCircle2 className="w-4 h-4" /> All apps added
        </div>
      ) : (
        <button
          onClick={() => onInstallAll(bundle)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border"
          style={{ borderColor: bundle.colorHex + '40', backgroundColor: bundle.colorHex + '15', color: bundle.colorHex }}
        >
          {installedCount > 0 ? `Add remaining ${bundleApps.length - installedCount} apps` : 'Install full stack'}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Intent Picker ────────────────────────────────────────────────────────────

const INTENTS = [
  { id: 'hiring',     label: 'Hiring',              icon: BriefcaseBusiness, color: '#7C3AED', bundleId: 'recruitment-stack' },
  { id: 'support',    label: 'Customer Support',     icon: Headset,           color: '#2563EB', bundleId: 'support-stack' },
  { id: 'finance',    label: 'Finance & Payments',   icon: HandCoins,         color: '#DC2626', bundleId: 'finance-stack' },
  { id: 'sales',      label: 'Sales',                icon: Building2,         color: '#059669', bundleId: 'sales-stack' },
  { id: 'it',         label: 'IT / Access Mgmt',     icon: Wrench,            color: '#D97706', bundleId: 'it-stack' },
  { id: 'compliance', label: 'Compliance',           icon: Gavel,             color: '#0891B2', bundleId: 'compliance-stack' },
];

function IntentPicker({ onSelect }: { onSelect: (bundleId: string) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <p className="text-sm font-bold text-white">What are you trying to automate?</p>
      </div>
      <p className="text-xs text-slate-400 mb-5">Pick a use case and we'll recommend the right apps.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {INTENTS.map(({ id, label, icon: Icon, color, bundleId }) => (
          <button
            key={id}
            onClick={() => onSelect(bundleId)}
            className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] text-left transition-all group"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + '20', border: `1px solid ${color}35` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <span className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Smart Recommendation Banner ──────────────────────────────────────────────

function RecommendationBanner({ apps, agents, onInstall }: { apps: MarketplaceApp[]; agents: AIAgent[]; onInstall: (app: MarketplaceApp) => void }) {
  // Find agents whose related apps aren't installed yet
  const agentIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    agents.forEach((a) => { if (a.id) map[a.id] = a.name; });
    return map;
  }, [agents]);

  const recommendations = useMemo(() => {
    return apps.filter((app) => {
      if (app.installed) return false;
      return app.relatedAgentIds.some((id) => agentIdToName[id]);
    }).slice(0, 3);
  }, [apps, agentIdToName]);

  if (recommendations.length === 0) return null;

  return (
    <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <p className="text-sm font-semibold text-white">Recommended for your agents</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {recommendations.map((app) => {
          const matchedAgents = app.relatedAgentIds.filter((id) => agentIdToName[id]).map((id) => agentIdToName[id]);
          return (
            <button
              key={app.id}
              onClick={() => onInstall(app)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/8 bg-white/[0.04] hover:bg-white/[0.08] text-left transition-all"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: app.colorHex }}>
                {app.logoLetter}
              </div>
              <div>
                <p className="text-xs font-semibold text-white leading-tight">{app.name}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Enhances {matchedAgents[0]}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 ml-1" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketplacePage({ onNavigate, agents = [] }: MarketplacePageProps) {
  const [tab, setTab] = useState<'store' | 'my-apps'>('store');
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [bundles, setBundles] = useState<AppBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [installTarget, setInstallTarget] = useState<MarketplaceApp | null>(null);
  const [showIntentPicker, setShowIntentPicker] = useState(true);
  const [highlightedBundleId, setHighlightedBundleId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, bundlesRes] = await Promise.all([
        api.marketplace.getAll(),
        api.marketplace.getBundles(),
      ]);
      if (appsRes.success && Array.isArray(appsRes.data)) setApps(appsRes.data);
      if (bundlesRes.success && Array.isArray(bundlesRes.data)) setBundles(bundlesRes.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Hide intent picker once any app is installed
  useEffect(() => {
    if (apps.some((a) => a.installed)) setShowIntentPicker(false);
  }, [apps]);

  const handleInstalled = (appId: string) => {
    setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, installed: true } : a)));
    setInstallTarget(null);
    setShowIntentPicker(false);
  };

  const handleUninstalled = (app: MarketplaceApp) => {
    setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, installed: false } : a)));
  };

  const handleIntentSelect = (bundleId: string) => {
    setHighlightedBundleId(bundleId);
    setShowIntentPicker(false);
    // Scroll to bundles section
    setTimeout(() => {
      document.getElementById('bundles-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleInstallBundle = (bundle: AppBundle) => {
    const uninstalledApps = apps.filter((a) => bundle.appIds.includes(a.id) && !a.installed);
    if (uninstalledApps.length > 0) setInstallTarget(uninstalledApps[0]);
  };

  // Build agent → name map for matching
  const agentRelatedApps = useMemo(() => {
    const agentIds = new Set(agents.map((a) => a.id).filter(Boolean));
    const map: Record<string, string[]> = {};
    apps.forEach((app) => {
      const matched = app.relatedAgentIds.filter((id) => agentIds.has(id));
      if (matched.length > 0) {
        const names = matched.map((id) => agents.find((a) => a.id === id)?.name || id);
        map[app.id] = names;
      }
    });
    return map;
  }, [apps, agents]);

  const installedApps = apps.filter((a) => a.installed);

  const filteredApps = useMemo(() => {
    return apps.filter((a) => {
      const matchCat = activeCategory === 'all' || a.category === activeCategory;
      const matchSearch = !search
        || a.name.toLowerCase().includes(search.toLowerCase())
        || a.description.toLowerCase().includes(search.toLowerCase())
        || a.developer.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [apps, activeCategory, search]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: apps.length };
    apps.forEach((a) => { counts[a.category] = (counts[a.category] || 0) + 1; });
    return counts;
  }, [apps]);

  return (
    <div className="flex h-full min-h-screen">
      {/* ── Left Sidebar ── */}
      <aside className="w-56 shrink-0 border-r border-white/8 p-4 flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto">
        {/* Tab switcher */}
        <div className="mb-4">
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setTab('store')}
              className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left', tab === 'store' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5')}
            >
              <ShoppingBag className="w-4 h-4" /> App Store
            </button>
            <button
              onClick={() => setTab('my-apps')}
              className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left', tab === 'my-apps' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5')}
            >
              <Zap className="w-4 h-4" />
              My Apps
              {installedApps.length > 0 && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">{installedApps.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* Category filter — only in store tab */}
        {tab === 'store' && (
          <>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-1">Categories</p>
            {Object.entries(CATEGORY_META).map(([key, { label, Icon, color }]) => (
              <button
                key={key}
                onClick={() => setActiveCategory(key)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors w-full text-left',
                  activeCategory === key
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', activeCategory === key ? 'text-white' : color)} />
                <span className="flex-1 truncate text-xs">{label}</span>
                {categoryCounts[key] !== undefined && (
                  <span className="text-[10px] text-slate-600">{categoryCounts[key]}</span>
                )}
              </button>
            ))}
          </>
        )}
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto">
        {/* ── APP STORE TAB ── */}
        {tab === 'store' && (
          <div className="p-6 max-w-5xl space-y-7">
            {/* Header */}
            <div>
              <h1 className="text-2xl font-bold text-white">App Store</h1>
              <p className="text-slate-400 text-sm mt-1">
                Add the apps your agents need. Every connection is governed by your Action Policies.
              </p>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search apps, categories, or actions…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveCategory('all'); }}
                className="w-full pl-10 pr-4 py-3 rounded-2xl border border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
              </div>
            ) : (
              <>
                {/* Intent picker (first time / no installs) */}
                {showIntentPicker && !search && activeCategory === 'all' && (
                  <IntentPicker onSelect={handleIntentSelect} />
                )}

                {/* Smart recommendation strip (has agents, not first time) */}
                {!showIntentPicker && agents.length > 0 && !search && activeCategory === 'all' && (
                  <RecommendationBanner apps={apps} agents={agents} onInstall={setInstallTarget} />
                )}

                {/* Bundles */}
                {!search && activeCategory === 'all' && bundles.length > 0 && (
                  <section id="bundles-section">
                    <div className="flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4 text-slate-400" />
                      <h2 className="text-sm font-semibold text-white">Install a stack</h2>
                      <span className="text-xs text-slate-500">— get a full workflow in one click</span>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                      {bundles.map((bundle) => (
                        <BundleCard
                          key={bundle.id}
                          bundle={bundle}
                          apps={apps}
                          onInstallAll={handleInstallBundle}
                        />
                      ))}
                    </div>
                    {highlightedBundleId && (
                      <p className="text-xs text-violet-300 mt-3 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        Showing recommended stack for your use case above.
                      </p>
                    )}
                  </section>
                )}

                {/* Featured */}
                {!search && activeCategory === 'all' && (
                  (() => {
                    const featured = apps.filter((a) => a.featured);
                    if (featured.length === 0) return null;
                    return (
                      <section>
                        <div className="flex items-center gap-2 mb-4">
                          <Star className="w-4 h-4 text-amber-300" />
                          <h2 className="text-sm font-semibold text-white">Featured</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {featured.map((app) => (
                            <AppCard key={app.id} app={app} onInstall={setInstallTarget} onUninstall={handleUninstalled} onNavigate={onNavigate} agentNames={agentRelatedApps[app.id]} />
                          ))}
                        </div>
                      </section>
                    );
                  })()
                )}

                {/* All apps / filtered */}
                <section>
                  {(search || activeCategory !== 'all') && (
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-sm font-semibold text-white">
                        {search ? `Results for "${search}"` : CATEGORY_META[activeCategory]?.label}
                      </h2>
                      <span className="text-xs text-slate-500">{filteredApps.length} apps</span>
                    </div>
                  )}
                  {!search && activeCategory !== 'all' && (
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-sm font-semibold text-white">{CATEGORY_META[activeCategory]?.label}</h2>
                      <span className="text-xs text-slate-500">{filteredApps.length} apps</span>
                    </div>
                  )}
                  {filteredApps.length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                      <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No apps found{search ? ` for "${search}"` : ''}.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredApps.map((app) => (
                        <AppCard key={app.id} app={app} onInstall={setInstallTarget} onUninstall={handleUninstalled} onNavigate={onNavigate} agentNames={agentRelatedApps[app.id]} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Governance footer */}
                <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 flex items-center gap-4">
                  <Shield className="w-7 h-7 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">All apps are governed by Rasi</p>
                    <p className="text-xs text-slate-400 mt-0.5">Every app operates within your Action Policies with full incident detection and cost monitoring.</p>
                  </div>
                  <button onClick={() => onNavigate?.('action-policies')} className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-slate-200 text-xs font-semibold transition-colors">
                    Manage Policies <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── MY APPS TAB ── */}
        {tab === 'my-apps' && (
          <div className="p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white">My Apps</h1>
                <p className="text-slate-400 text-sm mt-1">Apps your workspace has connected.</p>
              </div>
              <button
                onClick={() => void loadData()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
              </div>
            ) : installedApps.length === 0 ? (
              /* Empty state */
              <div className="text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mx-auto mb-5">
                  <ShoppingBag className="w-8 h-8 text-slate-500" />
                </div>
                <p className="text-base font-semibold text-white mb-2">No apps added yet</p>
                <p className="text-sm text-slate-400 mb-6 max-w-xs mx-auto">
                  Head to the App Store to browse integrations and connect the tools your agents need.
                </p>
                <button
                  onClick={() => setTab('store')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                >
                  <ShoppingBag className="w-4 h-4" /> Browse App Store
                </button>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                {(() => {
                  const healthyCount = installedApps.filter((a) => a.connectionStatus !== 'error' && a.connectionStatus !== 'expired' && !a.lastErrorMsg).length;
                  const issueCount = installedApps.length - healthyCount;
                  const actionsCount = installedApps.reduce((sum, a) => sum + (a.actionsUnlocked?.length || 0), 0);
                  return (
                    <div className="grid grid-cols-3 gap-3">
                      <div className={cn('rounded-xl border p-4 text-center', issueCount > 0 ? 'border-rose-400/15 bg-rose-500/[0.05]' : 'border-emerald-400/15 bg-emerald-500/[0.05]')}>
                        <p className={cn('text-2xl font-bold', issueCount > 0 ? 'text-rose-300' : 'text-emerald-300')}>{healthyCount} / {installedApps.length}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {issueCount > 0 ? `${issueCount} need${issueCount === 1 ? 's' : ''} attention` : 'All healthy'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-center">
                        <p className="text-2xl font-bold text-white">
                          {new Set(installedApps.flatMap((a) => a.relatedAgentIds)).size}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Agents Powered</p>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-center">
                        <p className="text-2xl font-bold text-white">{actionsCount}</p>
                        <p className="text-xs text-slate-400 mt-1">Actions Unlocked</p>
                      </div>
                    </div>
                  );
                })()}

                {/* App list — broken apps first */}
                <div className="space-y-2">
                  {[...installedApps].sort((a, b) => {
                    const aNeedsAttention = a.connectionStatus === 'error' || a.connectionStatus === 'expired' || Boolean(a.lastErrorMsg);
                    const bNeedsAttention = b.connectionStatus === 'error' || b.connectionStatus === 'expired' || Boolean(b.lastErrorMsg);
                    return Number(bNeedsAttention) - Number(aNeedsAttention);
                  }).map((app) => (
                    <MyAppCard
                      key={app.id}
                      app={app}
                      onRemove={handleUninstalled}
                      agentNames={agentRelatedApps[app.id]}
                    />
                  ))}
                </div>

                {/* CTA to add more */}
                <button
                  onClick={() => setTab('store')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-dashed border-white/15 text-slate-400 hover:text-white hover:border-white/25 text-sm font-medium transition-colors"
                >
                  <ShoppingBag className="w-4 h-4" /> Browse more apps
                </button>

                {/* Alert for no agent connections */}
                {agents.length === 0 && (
                  <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.04] p-4 flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-white">No agents in your workspace</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Connect an agent to start using these apps automatically.{' '}
                        <button onClick={() => onNavigate?.('connect')} className="text-blue-300 hover:underline">Add an agent →</button>
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Install Modal ── */}
      {installTarget && (
        <InstallModal
          app={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={handleInstalled}
        />
      )}
    </div>
  );
}
