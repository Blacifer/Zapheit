import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MetricQuery {
  label: string;
  action: string;
  params?: Record<string, any>;
  /** Extract a display value from the API response data */
  transform: (data: any) => string | number;
}

export interface IntegrationConfig {
  connectorId: string;
  appName: string;
  icon: React.ReactNode;
  workspacePath: string;
  /** Tailwind bg class for the icon badge, e.g. 'bg-blue-500/20' */
  brandBg: string;
  metrics: MetricQuery[];
}

type MetricValue = { label: string; value: string | number; loading: boolean; error?: boolean };

// ── Component ──────────────────────────────────────────────────────────────────

export function HubLiveMetrics({ configs, title, subtitle }: { configs: IntegrationConfig[]; title?: string; subtitle?: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, MetricValue[]>>({});
  const [syncTimes, setSyncTimes] = useState<Record<string, Date>>({});

  const fetchOne = useCallback(async (cfg: IntegrationConfig) => {
    // Set loading
    setData(prev => ({
      ...prev,
      [cfg.connectorId]: cfg.metrics.map(m => ({ label: m.label, value: '—', loading: true })),
    }));

    const settled = await Promise.allSettled(
      cfg.metrics.map(m =>
        api.unifiedConnectors.executeAction(cfg.connectorId, m.action, m.params || {}),
      ),
    );

    const values: MetricValue[] = cfg.metrics.map((m, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value.success) {
        try {
          return { label: m.label, value: m.transform(r.value.data?.data), loading: false };
        } catch {
          return { label: m.label, value: '—', loading: false, error: true };
        }
      }
      return { label: m.label, value: '—', loading: false, error: true };
    });

    setData(prev => ({ ...prev, [cfg.connectorId]: values }));
    setSyncTimes(prev => ({ ...prev, [cfg.connectorId]: new Date() }));
  }, []);

  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    // Pre-check which connectors are actually installed before firing execute calls.
    // This avoids noisy 400 errors for new users with no integrations.
    let cancelled = false;
    (async () => {
      try {
        const res = await api.unifiedConnectors.getCatalog();
        if (cancelled) return;
        const installedIds = new Set(
          (res.success && Array.isArray(res.data) ? res.data.filter((app) => app.installed) : []).map((app) => app.id),
        );
        const connected = configs.filter(c => installedIds.has(c.connectorId));
        if (connected.length > 0) {
          connected.forEach(c => void fetchOne(c));
        }
      } catch {
        // Silently skip — user just has no integrations yet
      } finally {
        if (!cancelled) setHasLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{title || 'Connected Apps'}</span>
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {configs.map(cfg => {
          const metrics = data[cfg.connectorId] || cfg.metrics.map(m => ({ label: m.label, value: '—', loading: true }));
          const synced = syncTimes[cfg.connectorId];

          return (
            <div
              key={cfg.connectorId}
              className="bg-slate-900/60 border border-white/[0.06] rounded-xl p-4 flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cfg.brandBg}`}>
                    {cfg.icon}
                  </div>
                  <span className="text-sm font-medium text-white">{cfg.appName}</span>
                </div>
                <button
                  onClick={() => void fetchOne(cfg)}
                  className="text-slate-600 hover:text-slate-300 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Metrics */}
              <div className="space-y-2">
                {metrics.map((m, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{m.label}</span>
                    {m.loading ? (
                      <div className="w-10 h-4 bg-slate-800 rounded animate-pulse" />
                    ) : m.error ? (
                      <AlertCircle className="w-3.5 h-3.5 text-slate-600" />
                    ) : (
                      <span className="text-sm font-semibold text-white tabular-nums">{m.value}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <span className="text-[10px] text-slate-600">
                  {synced ? `Synced ${timeAgo(synced)}` : 'Loading…'}
                </span>
                <button
                  onClick={() => navigate(cfg.workspacePath)}
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View in {cfg.appName}
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
