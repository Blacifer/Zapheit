import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Fingerprint, Sparkles, Network, AlertTriangle, RefreshCw, Plus, X, Loader2, Clock, Ban, Search,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { HubIdentityEvent, HubAccessGraph } from '../../types';

type TabId = 'events' | 'graph' | 'blast';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function severityBadge(s: string | null | undefined) {
  const m: Record<string, string> = {
    info: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    low: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    critical: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[s || 'info'] || m.info;
}

function anomalyColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s <= 30) return 'text-emerald-400';
  if (s <= 60) return 'text-amber-400';
  return 'text-rose-400';
}

function anomalyBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50';
  if (s <= 30) return 'bg-emerald-500/15 border-emerald-500/30';
  if (s <= 60) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}

function accessBadge(level: string) {
  const m: Record<string, string> = {
    read: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    write: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    admin: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    owner: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[level] || m.read;
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    inactive: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    revoked: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    pending_review: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  };
  return m[s] || m.active;
}

function eventIcon(type: string) {
  if (type.includes('failed') || type === 'account_locked' || type === 'suspicious_activity') return 'text-rose-400';
  if (type.includes('revoked') || type === 'user_deprovisioned') return 'text-amber-400';
  if (type.includes('granted') || type === 'user_provisioned') return 'text-emerald-400';
  return 'text-blue-400';
}

function relativeTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export default function IdentityHubPage() {
  const [tab, setTab] = useState<TabId>('events');
  const [busy, setBusy] = useState(false);

  // Events state
  const [events, setEvents] = useState<HubIdentityEvent[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [showCreateEvent, setShowCreateEvent] = useState(false);

  // Access graph state
  const [graph, setGraph] = useState<HubAccessGraph[]>([]);
  const [graphStatusFilter, setGraphStatusFilter] = useState('');
  const [showCreateAccess, setShowCreateAccess] = useState(false);

  // Blast radius state
  const [blastEmail, setBlastEmail] = useState('');
  const [blastResult, setBlastResult] = useState<{ user_email: string; systems: HubAccessGraph[]; total_systems: number; risk_summary: { high: number; medium: number; low: number } } | null>(null);

  const loadEvents = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.identity.listEvents({ event_type: eventTypeFilter || undefined, severity: severityFilter || undefined, limit: 200 });
      if (res.success && res.data) setEvents(res.data);
      else toast.error(res.error || 'Failed to load events');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }, [eventTypeFilter, severityFilter]);

  const loadGraph = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.identity.listAccessGraph({ status: graphStatusFilter || undefined, limit: 500 });
      if (res.success && res.data) setGraph(res.data);
      else toast.error(res.error || 'Failed to load access graph');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }, [graphStatusFilter]);

  useEffect(() => { void loadEvents(); }, [eventTypeFilter, severityFilter]);
  useEffect(() => { if (tab === 'graph') void loadGraph(); }, [tab, graphStatusFilter]);

  const handleScoreAnomaly = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.identity.scoreAnomaly(id);
      if (res.success) { toast.success('Anomaly scored'); void loadEvents(); }
      else toast.error(res.error || 'Scoring failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleScoreAll = async () => {
    setBusy(true);
    try {
      const res = await api.hubs.identity.scoreAllAnomalies();
      if (res.success) { toast.success(`Scored ${(res.data as any)?.scored || 0} events`); void loadEvents(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleBlastRadius = async () => {
    if (!blastEmail.trim()) { toast.error('Enter a user email'); return; }
    setBusy(true);
    try {
      const res = await api.hubs.identity.blastRadius(blastEmail.trim());
      if (res.success && res.data) setBlastResult(res.data);
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleRevokeAll = async (email: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.identity.revokeAll(email);
      if (res.success) {
        toast.success(`Revoked ${(res.data as any)?.revoked || 0} access entries`);
        if (blastResult) void handleBlastRadius();
        void loadGraph();
      } else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleRevokeOne = async (id: string) => {
    try {
      const res = await api.hubs.identity.updateAccessEntry(id, { status: 'revoked' });
      if (res.success) { toast.success('Access revoked'); void loadGraph(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  // Group access graph by user for the graph tab
  const groupedGraph = useMemo(() => {
    const groups = new Map<string, HubAccessGraph[]>();
    for (const entry of graph) {
      const key = entry.user_email;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [graph]);

  const eventTypes = ['login', 'login_failed', 'mfa_failed', 'access_granted', 'access_revoked', 'user_provisioned', 'user_deprovisioned', 'suspicious_activity'];

  const tabs = [
    { id: 'events' as const, label: 'Event Stream', icon: Fingerprint },
    { id: 'graph' as const, label: 'Access Graph', icon: Network },
    { id: 'blast' as const, label: 'Blast Radius', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Identity Hub</h1>
          <p className="text-sm text-slate-400 mt-1">Unified identity events, access graph, and blast-radius analysis across all connected IdPs.</p>
        </div>
        <button onClick={() => { if (tab === 'events') void loadEvents(); else void loadGraph(); }} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60">
          <RefreshCw className={cx('w-4 h-4', busy && 'animate-spin')} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cx(
            'px-3 py-1.5 rounded-full text-xs border inline-flex items-center gap-2',
            tab === t.id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'
          )}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ EVENT STREAM ═══ */}
      {tab === 'events' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={eventTypeFilter} onChange={e => setEventTypeFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All types</option>
              {eventTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All severity</option>
              {['info', 'low', 'medium', 'high', 'critical'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={handleScoreAll} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> Score All Anomalies
            </button>
            <button onClick={() => setShowCreateEvent(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Log Event
            </button>
          </div>

          {events.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Fingerprint className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No identity events found.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
              {events.map(ev => (
                <div key={ev.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={cx('w-14 h-14 rounded-full border flex flex-col items-center justify-center shrink-0', anomalyBg(ev.ai_anomaly_score))}>
                      {ev.ai_anomaly_score != null ? (
                        <><span className={cx('text-lg font-bold', anomalyColor(ev.ai_anomaly_score))}>{ev.ai_anomaly_score}</span><span className="text-[8px] text-slate-500 -mt-0.5">anomaly</span></>
                      ) : (<span className="text-xs text-slate-500">N/A</span>)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cx('text-sm font-semibold', eventIcon(ev.event_type))}>{ev.event_type.replace(/_/g, ' ')}</span>
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', severityBadge(ev.severity))}>{ev.severity}</span>
                        {ev.source_platform && <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/30">{ev.source_platform}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                        {ev.actor_email && <span>{ev.actor_email}</span>}
                        {ev.target_resource && <span>&#8594; {ev.target_resource}</span>}
                        {ev.target_system && <span className="text-slate-500">({ev.target_system})</span>}
                      </div>
                      {ev.ip_address && <p className="text-xs text-slate-500 mt-0.5">IP: {ev.ip_address}{ev.geo_location ? ` \u00b7 ${ev.geo_location}` : ''}</p>}
                      {ev.ai_anomaly_reasons && ev.ai_anomaly_reasons.length > 0 && ev.ai_anomaly_reasons[0] !== 'mock' && (
                        <div className="mt-2 bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                          <ul className="text-xs text-slate-300 space-y-0.5">
                            {ev.ai_anomaly_reasons.map((r, i) => <li key={i}>&bull; {r}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!ev.ai_scored_at && <button onClick={() => handleScoreAnomaly(ev.id)} disabled={busy} className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 disabled:opacity-40" title="Score Anomaly"><Sparkles className="w-4 h-4" /></button>}
                      <span className="text-[10px] text-slate-500 ml-1"><Clock className="w-3 h-3 inline" /> {relativeTime(ev.event_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ ACCESS GRAPH ═══ */}
      {tab === 'graph' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={graphStatusFilter} onChange={e => setGraphStatusFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All statuses</option>
              {['active', 'inactive', 'revoked', 'pending_review'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => setShowCreateAccess(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Entry
            </button>
          </div>

          {groupedGraph.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Network className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No access graph entries found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedGraph.map(([email, entries]) => (
                <div key={email} className="bg-slate-800/30 border border-slate-700 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 text-xs font-bold">
                        {email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-white">{entries[0]?.user_name || email}</span>
                        <p className="text-xs text-slate-500">{email} &middot; {entries.length} system{entries.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <button onClick={() => { setBlastEmail(email); setTab('blast'); void setTimeout(() => handleBlastRadius(), 100); }} className="px-2 py-1 rounded-lg text-xs text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Blast Radius
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {entries.map(e => (
                      <div key={e.id} className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-2 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-white truncate block">{e.system_name}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className={cx('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase border', accessBadge(e.access_level))}>{e.access_level}</span>
                            <span className={cx('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase border', statusBadge(e.status))}>{e.status.replace(/_/g, ' ')}</span>
                          </div>
                        </div>
                        {e.status === 'active' && (
                          <button onClick={() => handleRevokeOne(e.id)} className="p-1 rounded text-rose-400 hover:bg-rose-500/10" title="Revoke"><Ban className="w-3 h-3" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ BLAST RADIUS ═══ */}
      {tab === 'blast' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={blastEmail} onChange={e => setBlastEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleBlastRadius()} placeholder="Enter user email..." className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-3 py-2 text-sm text-white placeholder-slate-500" />
            </div>
            <button onClick={handleBlastRadius} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />} Calculate
            </button>
          </div>

          {!blastResult ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <AlertTriangle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Enter a user email to calculate blast radius — how many systems they can reach.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-white">{blastResult.total_systems}</p>
                  <p className="text-xs text-slate-400 mt-1">Total Systems</p>
                </div>
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-rose-400">{blastResult.risk_summary.high}</p>
                  <p className="text-xs text-slate-400 mt-1">Admin / Owner</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-amber-400">{blastResult.risk_summary.medium}</p>
                  <p className="text-xs text-slate-400 mt-1">Write Access</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-400">{blastResult.risk_summary.low}</p>
                  <p className="text-xs text-slate-400 mt-1">Read Only</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{blastResult.user_email}</h3>
                {blastResult.total_systems > 0 && (
                  <button onClick={() => handleRevokeAll(blastResult.user_email)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Ban className="w-3 h-3" /> Revoke All Access
                  </button>
                )}
              </div>

              {blastResult.systems.length > 0 ? (
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-700 text-slate-400 text-xs">
                      <th className="px-4 py-3 text-left">System</th>
                      <th className="px-4 py-3 text-left">Access Level</th>
                      <th className="px-4 py-3 text-left">Source</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Granted</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {blastResult.systems.map(s => (
                        <tr key={s.id}>
                          <td className="px-4 py-3 text-white font-medium">{s.system_name}</td>
                          <td className="px-4 py-3"><span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', accessBadge(s.access_level))}>{s.access_level}</span></td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{s.source_platform || '—'}</td>
                          <td className="px-4 py-3"><span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(s.status))}>{s.status.replace(/_/g, ' ')}</span></td>
                          <td className="px-4 py-3 text-xs text-slate-500">{s.granted_at ? relativeTime(s.granted_at) : '—'}</td>
                          <td className="px-4 py-3 text-center">
                            {s.status === 'active' && <button onClick={() => handleRevokeOne(s.id)} className="p-1 rounded text-rose-400 hover:bg-rose-500/10" title="Revoke"><Ban className="w-3.5 h-3.5" /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 text-center">
                  <p className="text-slate-400 text-sm">No active access found for this user.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCreateEvent && <CreateEventDrawer onClose={() => setShowCreateEvent(false)} onCreated={() => { setShowCreateEvent(false); void loadEvents(); }} />}
      {showCreateAccess && <CreateAccessDrawer onClose={() => setShowCreateAccess(false)} onCreated={() => { setShowCreateAccess(false); void loadGraph(); }} />}
    </div>
  );
}

function CreateEventDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ event_type: 'login' as string, severity: 'info', actor_email: '', target_resource: '', target_system: '', source_platform: 'manual', ip_address: '' });

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const res = await api.hubs.identity.createEvent({
        event_type: form.event_type as any, severity: form.severity as any,
        actor_email: form.actor_email.trim() || undefined, target_resource: form.target_resource.trim() || undefined,
        target_system: form.target_system.trim() || undefined, source_platform: form.source_platform || 'manual',
        ip_address: form.ip_address.trim() || undefined,
      });
      if (res.success) { toast.success('Event logged'); onCreated(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Log Identity Event</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Event Type *</label>
              <select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                {['login','login_failed','mfa_challenge','mfa_failed','password_reset','account_locked','access_granted','access_revoked','user_provisioned','user_deprovisioned','group_changed','role_changed','suspicious_activity','other'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div><label className="text-sm text-slate-300 block mb-1">Severity</label>
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                {['info','low','medium','high','critical'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-sm text-slate-300 block mb-1">Actor Email</label><input value={form.actor_email} onChange={e => setForm(f => ({ ...f, actor_email: e.target.value }))} placeholder="user@company.com" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Target Resource</label><input value={form.target_resource} onChange={e => setForm(f => ({ ...f, target_resource: e.target.value }))} placeholder="Production DB" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
            <div><label className="text-sm text-slate-300 block mb-1">Target System</label><input value={form.target_system} onChange={e => setForm(f => ({ ...f, target_system: e.target.value }))} placeholder="AWS, GitHub" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Source</label>
              <select value={form.source_platform} onChange={e => setForm(f => ({ ...f, source_platform: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="manual">Manual</option><option value="okta">Okta</option><option value="azure_ad">Azure AD</option><option value="google_workspace">Google Workspace</option>
              </select>
            </div>
            <div><label className="text-sm text-slate-300 block mb-1">IP Address</label><input value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} placeholder="192.168.1.1" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Log Event
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateAccessDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ user_email: '', user_name: '', system_name: '', access_level: 'read', source_platform: 'manual' });

  const handleSubmit = async () => {
    if (!form.user_email.trim() || !form.system_name.trim()) { toast.error('Email and System are required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.identity.createAccessEntry({
        user_email: form.user_email.trim(), user_name: form.user_name.trim() || undefined,
        system_name: form.system_name.trim(), access_level: form.access_level as any,
        source_platform: form.source_platform || 'manual',
      });
      if (res.success) { toast.success('Access entry created'); onCreated(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Add Access Entry</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="text-sm text-slate-300 block mb-1">User Email *</label><input value={form.user_email} onChange={e => setForm(f => ({ ...f, user_email: e.target.value }))} placeholder="user@company.com" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">User Name</label><input value={form.user_name} onChange={e => setForm(f => ({ ...f, user_name: e.target.value }))} placeholder="John Doe" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">System Name *</label><input value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} placeholder="AWS, GitHub, Jira" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Access Level</label>
              <select value={form.access_level} onChange={e => setForm(f => ({ ...f, access_level: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="read">Read</option><option value="write">Write</option><option value="admin">Admin</option><option value="owner">Owner</option>
              </select>
            </div>
            <div><label className="text-sm text-slate-300 block mb-1">Source</label>
              <select value={form.source_platform} onChange={e => setForm(f => ({ ...f, source_platform: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="manual">Manual</option><option value="okta">Okta</option><option value="azure_ad">Azure AD</option><option value="google_workspace">Google Workspace</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Entry
          </button>
        </div>
      </div>
    </div>
  );
}
