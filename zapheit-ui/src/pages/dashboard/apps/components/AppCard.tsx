import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertCircle, ArrowRight, Bell, BellOff,
  ChevronDown, ChevronRight, Clock, ExternalLink, Loader2, RefreshCw,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { AppDef } from '../data/catalog';
import type { UnifiedApp } from '../types';
import { GOV_LABEL, GOV_COLOR, getGovTier } from '../data/governance';
import { LIVE_METRICS } from '../data/live-metrics';
import { CONNECTOR_ACTIONS, RISK_COLOR } from '../data/connector-actions';
import { certificationTone, deriveConnectorCertification } from '../../../../lib/production-readiness';
import { AppLogo } from './AppLogo';
import { SetupScoreBar } from './SetupScoreBar';
import { setupScore } from './setup-score';
import { getNotifiedApps, toggleNotifyApp } from '../data/notifications';

export type ConnStatus = 'connected' | 'disconnected' | 'error';

/* 5-minute cache for live metrics */
export const METRIC_CACHE = new Map<string, { value: string; expiresAt: number }>();

export function highlightText(text: string, terms: string[] | undefined): React.ReactNode {
  if (!terms?.length) return text;
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="bg-yellow-400/25 text-yellow-200 rounded px-0.5">{part}</mark> : part,
  );
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

interface AppCardProps {
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
  highlightTerms?: string[];
}

export function AppCard({
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
  highlightTerms,
}: AppCardProps) {
  const [busy, setBusy] = useState(false);
  const [liveMetric, setLiveMetric] = useState<string | null>(null);
  const [notified, setNotified] = useState(() => getNotifiedApps().has(app.appId));
  const [actionsOpen, setActionsOpen] = useState(false);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const metricFetched = useRef(false);
  const usageFetched = useRef(false);

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
  const certification = backendUnified?.connectorCertification || deriveConnectorCertification({
    connectorId: app.appId,
    comingSoon: app.productionStatus === 'coming_soon',
    connected: isConnected,
    status,
    healthStatus: backendUnified?.healthStatus,
    capabilityPolicies: backendUnified?.capabilityPolicies || [],
    permissions: backendUnified?.permissions || [],
    actionsUnlocked: backendUnified?.actionsUnlocked || connectorActions.map((action) => action.label),
  });

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
            <h3 className="text-sm font-semibold text-white">{highlightText(app.name, highlightTerms)}</h3>

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

            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-500 font-mono">
              {app.auth === 'oauth' ? 'OAuth 2.0' : 'API Key'}
            </span>

            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', GOV_COLOR[govTier])}>
              {GOV_LABEL[govTier]}
            </span>

            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', certificationTone(certification.state))}>
              {certification.label}
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-lg">{app.description}</p>

          {!certification.certified && app.productionStatus !== 'coming_soon' && (
            <p className="mt-1 text-[11px] text-amber-300/80">
              Certification required before this connector should be used for paid-pilot production work.
            </p>
          )}
          {certification.certified && certification.evidence.length > 0 && (
            <p className="mt-1 text-[11px] text-emerald-300/75">
              Evidence: {certification.evidence.slice(0, 2).join(' · ')}
            </p>
          )}
          {!certification.certified && certification.missingChecks.length > 0 && app.productionStatus !== 'coming_soon' && (
            <p className="mt-1 text-[11px] text-slate-500">
              Missing checks: {certification.missingChecks.slice(0, 3).join(', ')}
            </p>
          )}

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

          {isConnected && health && (
            <div className={cn('mt-1.5 flex items-center gap-1.5 text-[11px]', health.good ? 'text-emerald-400/70' : 'text-amber-400')}>
              {health.good ? <RefreshCw className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {health.label}
            </div>
          )}

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

          {isConnected && connectorActions.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setActionsOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                {actionsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Production action contract
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

          {app.productionStatus === 'coming_soon' && !isConnected && (
            <button
              onClick={handleNotifyToggle}
              className={cn(
                'mt-2 flex items-center gap-1.5 text-[11px] transition-colors',
                notified ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300',
              )}
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
                onClick={() => onOpenWizard(app, backendUnified)}
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
          ) : (
            <button
              onClick={() => onOpenWizard(app, backendUnified)}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold transition-all"
            >
              Connect
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
