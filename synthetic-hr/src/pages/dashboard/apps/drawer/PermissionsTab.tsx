import { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';

interface PermissionsTabProps {
  app: UnifiedApp;
}

// Derive a display label from a snake_case action/capability ID
function actionLabel(id: string): string {
  return id
    .split('__').pop()!
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const RISK_COLORS: Record<string, string> = {
  money: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  high: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  medium: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  low: 'text-slate-400 border-slate-600 bg-slate-800/50',
};

export function PermissionsTab({ app }: PermissionsTabProps) {
  const serviceId = app.source === 'marketplace' ? app.appData?.id : app.integrationData?.id;
  // All possible capabilities come from the app's actionsUnlocked list
  const allCapabilities: string[] = app.actionsUnlocked ?? [];

  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Load current enabled_capabilities from the backend on mount
  useEffect(() => {
    if (!serviceId) { setLoading(false); return; }
    api.integrations.get(serviceId).then((res: any) => {
      const caps: string[] = res?.data?.enabled_capabilities ?? [];
      // Empty array = all allowed; pre-populate all as enabled for display
      setEnabledSet(caps.length === 0 ? new Set(allCapabilities) : new Set(caps));
    }).catch(() => {
      setEnabledSet(new Set(allCapabilities));
    }).finally(() => setLoading(false));
  }, [serviceId]);

  const toggle = async (capId: string) => {
    if (!serviceId || saving) return;
    setSaving(capId);
    const next = new Set(enabledSet);
    if (next.has(capId)) {
      next.delete(capId);
    } else {
      next.add(capId);
    }
    // If all are enabled, send empty array (backwards-compatible default = allow all)
    const payload = next.size === allCapabilities.length ? [] : Array.from(next);
    const res = await api.integrations.updateCapabilities(serviceId, payload);
    if (res.success) {
      setEnabledSet(next);
      toast.success(`${actionLabel(capId)} ${next.has(capId) ? 'enabled' : 'disabled'}`);
    } else {
      toast.error((res as any).error || 'Failed to update capability');
    }
    setSaving(null);
  };

  if (!app.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <ShieldCheck className="w-8 h-8 text-slate-600" />
        <p className="text-sm text-slate-500">Connect this app to manage permissions.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    );
  }

  if (allCapabilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <ShieldCheck className="w-8 h-8 text-slate-600" />
        <p className="text-sm text-slate-500">No configurable permissions for this app.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200/80 leading-relaxed">
          Disabling a capability blocks agents from executing that action — even if an action policy would otherwise allow it.
        </p>
      </div>

      <div className="divide-y divide-white/5 rounded-xl border border-white/8 overflow-hidden">
        {allCapabilities.map((capId) => {
          const enabled = enabledSet.has(capId);
          const isSaving = saving === capId;
          // Infer risk level from action name heuristics
          const risk = /refund|pay|charge|delete|terminate/i.test(capId)
            ? 'money'
            : /update|send|create/i.test(capId)
            ? 'high'
            : 'medium';

          return (
            <div key={capId} className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-900/40 hover:bg-slate-800/50 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{actionLabel(capId)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide', RISK_COLORS[risk])}>
                    {risk}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono truncate">{capId}</span>
                </div>
              </div>
              <button
                onClick={() => toggle(capId)}
                disabled={!!saving}
                aria-label={enabled ? `Disable ${actionLabel(capId)}` : `Enable ${actionLabel(capId)}`}
                className="shrink-0 flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                ) : enabled ? (
                  <ToggleRight className="w-7 h-7 text-cyan-400" />
                ) : (
                  <ToggleLeft className="w-7 h-7 text-slate-600" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
