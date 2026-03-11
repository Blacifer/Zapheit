import { useRef, useState, useEffect } from 'react';
import { Activity, AlertTriangle, Clock, TrendingUp, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../lib/api-client';

interface SystemMetrics {
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  throughput: {
    rpm: number;
    total5min: number;
  };
  errors: {
    count: number;
    rate: number;
  };
  auth: {
    failures: number;
    successes: number;
    failureRate: number;
  };
}

interface DeliveryMetrics {
  summary: {
    totalAlerts: number;
    deliveredAlerts: number;
    failedAlerts: number;
    deliverySuccessRate: number;
    avgDeliveryTimeMs: number;
  };
  slo: {
    target: {
      deliverySuccessRate: number;
      maxDeliveryTimeMs: number;
    };
    current: {
      deliverySuccessRate: number;
      avgDeliveryTimeMs: number;
    };
    met: {
      deliverySuccessRateMet: boolean;
      avgDeliveryTimeMet: boolean;
      overallSloMet: boolean;
    };
  };
}

export default function OperationalMetrics() {
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [deliveryMetrics, setDeliveryMetrics] = useState<DeliveryMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadMetrics();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      setRefreshKey((prev) => prev + 1);
      void loadMetrics();
    }, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const loadMetrics = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [systemRes, deliveryRes] = await Promise.all([
        api.metrics.getSystemMetrics(),
        api.metrics.getDeliveryMetrics(),
      ]);

      if (systemRes.success && systemRes.data) {
        if (mountedRef.current) setSystemMetrics(systemRes.data);
      }
      if (deliveryRes.success && deliveryRes.data) {
        if (mountedRef.current) setDeliveryMetrics(deliveryRes.data);
      }
    } catch (error) {
      // Abort/cancel errors can happen during fast refreshes; ignore.
      const anyErr = error as any;
      const isAbort = anyErr?.name === 'AbortError' || String(anyErr?.message || '').toLowerCase().includes('lock broken');
      if (!isAbort) {
        console.error('Failed to load operational metrics:', error);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
          <h3 className="text-lg font-semibold text-white">Operational Metrics</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-3/4 mb-3"></div>
              <div className="h-8 bg-slate-700 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sloMet = deliveryMetrics?.slo.met.overallSloMet ?? true;

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/10 rounded-lg">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Service Health</h3>
            <p className="text-xs text-slate-400">Real-time operational metrics • Auto-refresh 10s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sloMet ? (
            <span className="flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs">
              <CheckCircle className="w-3 h-3" />
              SLO Met
            </span>
          ) : (
            <span className="flex items-center gap-1 px-3 py-1 bg-red-500/10 text-red-400 rounded-full text-xs">
              <XCircle className="w-3 h-3" />
              SLO Breach
            </span>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* API Latency P95 */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <p className="text-slate-400 text-xs font-medium">P95 Latency</p>
          </div>
          <p className="text-2xl font-bold text-white">
            {systemMetrics?.latency.p95 || 0}
            <span className="text-sm text-slate-400 ml-1">ms</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            P50: {systemMetrics?.latency.p50 || 0}ms • P99: {systemMetrics?.latency.p99 || 0}ms
          </p>
        </div>

        {/* Throughput */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <p className="text-slate-400 text-xs font-medium">Throughput</p>
          </div>
          <p className="text-2xl font-bold text-white">
            {systemMetrics?.throughput.rpm || 0}
            <span className="text-sm text-slate-400 ml-1">req/min</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Last 5min: {systemMetrics?.throughput.total5min || 0} requests
          </p>
        </div>

        {/* Error Rate */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className={`w-4 h-4 ${(systemMetrics?.errors.rate || 0) > 1 ? 'text-red-400' : 'text-green-400'}`} />
            <p className="text-slate-400 text-xs font-medium">Error Rate</p>
          </div>
          <p className={`text-2xl font-bold ${(systemMetrics?.errors.rate || 0) > 1 ? 'text-red-400' : 'text-green-400'}`}>
            {systemMetrics?.errors.rate.toFixed(2) || '0.00'}
            <span className="text-sm text-slate-400 ml-1">%</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {systemMetrics?.errors.count || 0} errors (5xx)
          </p>
        </div>

        {/* Alert Delivery SLO */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className={`w-4 h-4 ${sloMet ? 'text-green-400' : 'text-amber-400'}`} />
            <p className="text-slate-400 text-xs font-medium">Alert Delivery</p>
          </div>
          <p className={`text-2xl font-bold ${sloMet ? 'text-green-400' : 'text-amber-400'}`}>
            {deliveryMetrics?.summary.deliverySuccessRate.toFixed(1) || '0.0'}
            <span className="text-sm text-slate-400 ml-1">%</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Target: {deliveryMetrics?.slo.target.deliverySuccessRate}% • {deliveryMetrics?.summary.avgDeliveryTimeMs || 0}ms avg
          </p>
        </div>
      </div>

      {/* Auth Metrics */}
      {systemMetrics && systemMetrics.auth.failures + systemMetrics.auth.successes > 0 && (
        <div className="bg-slate-900/30 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400 mb-1">Authentication</p>
              <div className="flex items-center gap-4">
                <span className="text-xs text-green-400">
                  ✓ {systemMetrics.auth.successes} Success
                </span>
                <span className="text-xs text-red-400">
                  ✗ {systemMetrics.auth.failures} Failed
                </span>
                <span className="text-xs text-slate-400">
                  Failure Rate: {systemMetrics.auth.failureRate.toFixed(2)}%
                </span>
              </div>
            </div>
            {systemMetrics.auth.failureRate > 5 && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 text-amber-400 rounded text-xs">
                <AlertTriangle className="w-3 h-3" />
                High auth failures
              </div>
            )}
          </div>
        </div>
      )}

      {/* SLO Targets */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-slate-500">
              SLO Targets: Delivery {deliveryMetrics?.slo.target.deliverySuccessRate}%
            </span>
            <span className="text-slate-500">
              Latency &lt; {deliveryMetrics?.slo.target.maxDeliveryTimeMs}ms
            </span>
          </div>
          <span className="text-slate-500">
            Auto-refresh in {10 - (refreshKey % 10)}s
          </span>
        </div>
      </div>
    </div>
  );
}
