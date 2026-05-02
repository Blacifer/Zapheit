import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Eye, Loader2, Save, Shield, X, Zap,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';
import { APP_CATALOG } from './data/catalog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PermLevel = 'full' | 'observe' | 'none';

const LEVELS: PermLevel[] = ['none', 'full', 'observe'];

const LEVEL_META: Record<PermLevel, { label: string; short: string; icon: typeof CheckCircle2; cell: string; badge: string }> = {
  full: {
    label: 'Full Access',
    short: 'Full',
    icon: Zap,
    cell: 'bg-emerald-500/[0.12] border-emerald-500/30 hover:bg-emerald-500/20',
    badge: 'text-emerald-300',
  },
  observe: {
    label: 'Observe Only',
    short: 'Observe',
    icon: Eye,
    cell: 'bg-amber-500/[0.10] border-amber-500/25 hover:bg-amber-500/18',
    badge: 'text-amber-300',
  },
  none: {
    label: 'No Access',
    short: 'None',
    icon: X,
    cell: 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]',
    badge: 'text-slate-600',
  },
};

function cycleLevel(current: PermLevel): PermLevel {
  const idx = LEVELS.indexOf(current);
  return LEVELS[(idx + 1) % LEVELS.length];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function agentInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function agentColor(id: string): string {
  const COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xfffffff;
  return COLORS[h % COLORS.length];
}

/* Persist Observe overrides in localStorage so they survive refresh */
const LS_KEY = 'zapheit:perm_matrix:observe';
function loadObserveSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveObserveSet(s: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify([...s]));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PermissionMatrix() {
  const navigate = useNavigate();

  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [connectedAppIds, setConnectedAppIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // agentId → Set<appId> for Full access
  const [fullMap, setFullMap] = useState<Record<string, Set<string>>>({});
  // agentId_appId keys for Observe level
  const [observeSet, setObserveSet] = useState<Set<string>>(loadObserveSet);

  /* ---- Load data ---- */
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [agentRes, integRes] = await Promise.all([
          api.agents.getAll(),
          api.integrations.getAll(),
        ]);

        const loadedAgents: AIAgent[] = Array.isArray(agentRes.data) ? agentRes.data : [];
        setAgents(loadedAgents);

        // Determine connected apps from integrations + APP_CATALOG
        const connectedServices = new Set<string>();
        const integrations = (integRes as any)?.data ?? [];
        if (Array.isArray(integrations)) {
          integrations.forEach((i: any) => {
            const svc = i.service_id || i.serviceId || i.provider || i.app_id;
            if (svc) connectedServices.add(svc);
          });
        }

        const appIds = APP_CATALOG
          .filter((a) => connectedServices.has(a.serviceId) || connectedServices.has(a.appId))
          .map((a) => a.appId);
        setConnectedAppIds(appIds);

        // Init fullMap from agent.integrationIds
        const fm: Record<string, Set<string>> = {};
        loadedAgents.forEach((agent) => {
          fm[agent.id] = new Set(agent.integrationIds ?? []);
        });
        setFullMap(fm);
      } catch (err) {
        console.warn('[PermissionMatrix] load failed:', err);
        toast.error('Failed to load permission data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---- Derive permission level for a cell ---- */
  const getLevel = useCallback((agentId: string, appId: string): PermLevel => {
    const key = `${agentId}:${appId}`;
    if (fullMap[agentId]?.has(appId)) {
      return observeSet.has(key) ? 'observe' : 'full';
    }
    return 'none';
  }, [fullMap, observeSet]);

  /* ---- Toggle a cell ---- */
  const toggle = useCallback((agentId: string, appId: string) => {
    const current = getLevel(agentId, appId);
    const next = cycleLevel(current);
    const key = `${agentId}:${appId}`;

    setFullMap((prev) => {
      const updated = { ...prev, [agentId]: new Set(prev[agentId] ?? []) };
      if (next === 'none') {
        updated[agentId].delete(appId);
      } else {
        updated[agentId].add(appId);
      }
      return updated;
    });

    setObserveSet((prev) => {
      const next2 = new Set(prev);
      if (next === 'observe') next2.add(key);
      else next2.delete(key);
      saveObserveSet(next2);
      return next2;
    });

    setDirty(true);
  }, [getLevel]);

  /* ---- Save ---- */
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all(
        agents.map((agent) => {
          const connectorIds = [...(fullMap[agent.id] ?? [])];
          return api.unifiedConnectors.updateAgentConnectors(agent.id, connectorIds);
        }),
      );
      toast.success('Permissions saved');
      setDirty(false);
    } catch {
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  }, [agents, fullMap]);

  /* ---- Connected apps metadata ---- */
  const connectedApps = useMemo(
    () => connectedAppIds.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as typeof APP_CATALOG,
    [connectedAppIds],
  );

  /* ---- Per-agent totals ---- */
  const agentTotals = useMemo(() => {
    const out: Record<string, { full: number; observe: number }> = {};
    agents.forEach((agent) => {
      let full = 0; let observe = 0;
      connectedApps.forEach((app) => {
        const lvl = getLevel(agent.id, app.appId);
        if (lvl === 'full') full++;
        else if (lvl === 'observe') observe++;
      });
      out[agent.id] = { full, observe };
    });
    return out;
  }, [agents, connectedApps, getLevel]);

  /* ---- Per-app totals ---- */
  const appTotals = useMemo(() => {
    const out: Record<string, { full: number; observe: number }> = {};
    connectedApps.forEach((app) => {
      let full = 0; let observe = 0;
      agents.forEach((agent) => {
        const lvl = getLevel(agent.id, app.appId);
        if (lvl === 'full') full++;
        else if (lvl === 'observe') observe++;
      });
      out[app.appId] = { full, observe };
    });
    return out;
  }, [agents, connectedApps, getLevel]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080f1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          <p className="text-sm text-slate-400">Loading permission matrix…</p>
        </div>
      </div>
    );
  }

  const isEmpty = agents.length === 0 || connectedApps.length === 0;

  return (
    <div className="min-h-screen bg-[#080f1a]">
      {/* Page header */}
      <div className="border-b border-white/[0.06] bg-[#080f1a]/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard/apps')}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <Shield className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Agent–App Permission Matrix</h1>
              <p className="text-[11px] text-slate-500">
                {agents.length} agent{agents.length !== 1 ? 's' : ''} · {connectedApps.length} connected app{connectedApps.length !== 1 ? 's' : ''}
                {dirty && <span className="ml-2 text-amber-400">· Unsaved changes</span>}
              </p>
            </div>
          </div>

          {/* Legend */}
          <div className="hidden sm:flex items-center gap-4 text-[11px]">
            {(['full', 'observe', 'none'] as PermLevel[]).map((lvl) => {
              const m = LEVEL_META[lvl];
              return (
                <div key={lvl} className="flex items-center gap-1.5">
                  <m.icon className={cn('w-3 h-3', m.badge)} />
                  <span className={m.badge}>{m.label}</span>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
              dirty
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-900/30'
                : 'bg-white/[0.04] text-slate-500 cursor-default border border-white/[0.06]',
            )}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-violet-400" />
          </div>
          <p className="text-lg font-semibold text-white mb-2">No data to display</p>
          <p className="text-sm text-slate-400 max-w-sm">
            Connect some apps and create agents first, then come back here to govern exactly which agents can access which apps.
          </p>
          <button
            onClick={() => navigate('/dashboard/apps')}
            className="mt-6 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
          >
            Go to Apps
          </button>
        </div>
      ) : (
        <div className="max-w-[1400px] mx-auto px-6 py-6 overflow-x-auto">
          <table className="border-collapse" style={{ minWidth: `${180 + connectedApps.length * 120}px` }}>
            {/* ---- Column headers (apps) ---- */}
            <thead>
              <tr>
                {/* Top-left corner cell */}
                <th className="w-44 pb-3 pr-4 text-left align-bottom">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Agent</p>
                </th>

                {connectedApps.map((app) => (
                  <th key={app.appId} className="pb-3 px-1 text-center align-bottom min-w-[120px]">
                    <div className="flex flex-col items-center gap-1.5">
                      {/* App logo */}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-bold text-white shadow-sm"
                        style={{ background: app.colorHex }}
                      >
                        {app.logoLetter.slice(0, 2)}
                      </div>
                      <p className="text-[11px] font-semibold text-slate-300 leading-tight text-center max-w-[90px] break-words">
                        {app.name}
                      </p>
                      {/* App totals */}
                      <div className="flex items-center gap-1 text-[9px]">
                        {appTotals[app.appId]?.full > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                            {appTotals[app.appId].full}F
                          </span>
                        )}
                        {appTotals[app.appId]?.observe > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
                            {appTotals[app.appId].observe}O
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                ))}

                {/* Summary column header */}
                <th className="pb-3 pl-4 text-center align-bottom min-w-[80px]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Access</p>
                </th>
              </tr>
            </thead>

            <tbody>
              {agents.map((agent, agentIdx) => (
                <tr key={agent.id} className={cn(agentIdx % 2 === 0 ? '' : 'bg-white/[0.01]')}>
                  {/* Agent name cell */}
                  <td className="py-2 pr-4 align-middle">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                        style={{ background: agentColor(agent.id) }}
                      >
                        {agentInitials(agent.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate max-w-[130px]">{agent.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{agent.agent_type || 'Agent'}</p>
                      </div>
                    </div>
                  </td>

                  {/* Permission cells */}
                  {connectedApps.map((app) => {
                    const lvl = getLevel(agent.id, app.appId);
                    const meta = LEVEL_META[lvl];
                    const Icon = meta.icon;
                    return (
                      <td key={app.appId} className="py-2 px-1 text-center align-middle">
                        <button
                          onClick={() => toggle(agent.id, app.appId)}
                          title={`${agent.name} → ${app.name}: ${meta.label} (click to change)`}
                          className={cn(
                            'w-full h-11 rounded-xl border transition-all duration-150 flex flex-col items-center justify-center gap-0.5 group',
                            meta.cell,
                          )}
                        >
                          <Icon className={cn('w-3.5 h-3.5 transition-transform group-hover:scale-110', meta.badge)} />
                          <span className={cn('text-[9px] font-semibold tracking-wide', meta.badge)}>
                            {meta.short}
                          </span>
                        </button>
                      </td>
                    );
                  })}

                  {/* Summary cell */}
                  <td className="py-2 pl-4 text-center align-middle">
                    <div className="flex flex-col items-center gap-1">
                      {agentTotals[agent.id]?.full > 0 && (
                        <span className="text-[11px] font-bold text-emerald-400">
                          {agentTotals[agent.id].full}
                          <span className="text-[9px] font-normal text-emerald-500/70 ml-0.5">full</span>
                        </span>
                      )}
                      {agentTotals[agent.id]?.observe > 0 && (
                        <span className="text-[11px] font-bold text-amber-400">
                          {agentTotals[agent.id].observe}
                          <span className="text-[9px] font-normal text-amber-500/70 ml-0.5">obs</span>
                        </span>
                      )}
                      {agentTotals[agent.id]?.full === 0 && agentTotals[agent.id]?.observe === 0 && (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {/* Bottom summary row */}
              <tr className="border-t border-white/[0.06]">
                <td className="pt-4 pr-4 align-middle">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Agents with access</p>
                </td>
                {connectedApps.map((app) => {
                  const t = appTotals[app.appId] ?? { full: 0, observe: 0 };
                  const total = t.full + t.observe;
                  return (
                    <td key={app.appId} className="pt-4 px-1 text-center align-middle">
                      <div className={cn(
                        'text-sm font-bold',
                        total === agents.length ? 'text-emerald-400' :
                        total > 0 ? 'text-amber-400' : 'text-slate-600',
                      )}>
                        {total}
                        <span className="text-[10px] text-slate-500 font-normal ml-0.5">/{agents.length}</span>
                      </div>
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>

          {/* Info bar */}
          <div className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-wrap gap-6 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span><strong className="text-emerald-300">Full</strong> — Agent can read data and execute write actions</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              <span><strong className="text-amber-300">Observe</strong> — Agent can read data only (write actions blocked)</span>
            </div>
            <div className="flex items-center gap-2">
              <X className="w-3.5 h-3.5 text-slate-500" />
              <span><strong className="text-slate-400">None</strong> — Agent has no access to this app</span>
            </div>
            <div className="ml-auto text-slate-500">
              Click any cell to cycle between permission levels · Changes are saved when you click Save
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
