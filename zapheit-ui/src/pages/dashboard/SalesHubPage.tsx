import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Sparkles, TrendingDown, Settings2, RefreshCw, Plus, X, Check, Loader2,
  ChevronRight,
} from 'lucide-react';
import { Briefcase } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { HubLiveMetrics } from './hubs/HubLiveMetrics';
import type { IntegrationConfig } from './hubs/HubLiveMetrics';
import type { SalesLeadHub } from '../../types';

type TabId = 'pipeline' | 'heatmap' | 'settings';

const SALES_INTEGRATIONS: IntegrationConfig[] = [
  {
    connectorId: 'hubspot',
    appName: 'HubSpot',
    icon: <Briefcase className="w-3.5 h-3.5 text-orange-400" />,
    workspacePath: '/dashboard/apps/hubspot/workspace',
    brandBg: 'bg-orange-500/20',
    metrics: [
      { label: 'Total Deals', action: 'list_deals', params: { limit: 1 }, transform: d => d?.results?.length ?? (Array.isArray(d) ? d.length : '—') },
      { label: 'Contacts', action: 'list_contacts', params: { limit: 1 }, transform: d => d?.results?.length ?? (Array.isArray(d) ? d.length : '—') },
      { label: 'Companies', action: 'list_companies', params: { limit: 1 }, transform: d => d?.results?.length ?? (Array.isArray(d) ? d.length : '—') },
    ],
  },
];

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function scoreColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 70) return 'text-emerald-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50';
  if (s >= 70) return 'bg-emerald-500/15 border-emerald-500/30';
  if (s >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}

const STAGES = ['new', 'qualified', 'discovery', 'demo', 'proposal', 'won', 'lost'] as const;
const STAGE_COLORS: Record<string, string> = {
  new: 'border-blue-500/30', qualified: 'border-cyan-500/30', discovery: 'border-purple-500/30',
  demo: 'border-amber-500/30', proposal: 'border-emerald-500/30', won: 'border-green-500/30', lost: 'border-rose-500/30',
};

function formatValue(v: number | null | undefined, currency?: string | null) {
  if (v == null) return '';
  const c = currency || 'INR';
  if (c === 'INR') {
    if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
    if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
    return `₹${v.toLocaleString('en-IN')}`;
  }
  return `${c} ${v.toLocaleString()}`;
}

function daysAgo(dateStr: string | null | undefined): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function relativeTime(dateStr: string | null | undefined): string {
  const d = daysAgo(dateStr);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function SalesHubPage() {
  const [tab, setTab] = useState<TabId>('pipeline');
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<SalesLeadHub[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [coldThreshold, setColdThreshold] = useState(7);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.sales.listLeads({ limit: 200 });
      if (res.success && res.data) setLeads(res.data);
      else toast.error(res.error || 'Failed to load leads');
    } catch (e: any) { toast.error(e?.message || 'Failed to load leads'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, []);

  const byStage = useMemo(() => {
    const m: Record<string, SalesLeadHub[]> = {};
    STAGES.forEach(s => { m[s] = []; });
    leads.forEach(l => { (m[l.stage] || (m['new'] = m['new'] || [])).push(l); });
    return m;
  }, [leads]);

  const coldDeals = useMemo(() =>
    leads.filter(l => l.stage !== 'won' && l.stage !== 'lost' && (daysAgo(l.last_activity_at || l.created_at) >= coldThreshold || (l.ai_deal_score != null && l.ai_deal_score < 40)))
      .sort((a, b) => daysAgo(b.last_activity_at || b.created_at) - daysAgo(a.last_activity_at || a.created_at)),
    [leads, coldThreshold]);

  const handleScore = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.sales.scoreLead(id);
      if (res.success) { toast.success('Lead scored'); void load(); }
      else toast.error(res.error || 'Scoring failed');
    } catch (e: any) { toast.error(e?.message || 'Scoring failed'); }
    finally { setBusy(false); }
  };

  const handleScoreAll = async () => {
    setBusy(true);
    try {
      const res = await api.hubs.sales.scoreAll();
      if (res.success) { toast.success(`Scored ${(res.data as any)?.scored || 0} leads`); void load(); }
      else toast.error(res.error || 'Batch scoring failed');
    } catch (e: any) { toast.error(e?.message || 'Batch scoring failed'); }
    finally { setBusy(false); }
  };

  const handleAdvanceStage = async (lead: SalesLeadHub) => {
    const idx = STAGES.indexOf(lead.stage as any);
    if (idx < 0 || idx >= STAGES.length - 2) return; // can't advance past proposal or from won/lost
    const next = STAGES[idx + 1];
    try {
      const res = await api.hubs.sales.updateLead(lead.id, { stage: next });
      if (res.success) { toast.success(`Moved to ${next}`); void load(); }
      else toast.error(res.error || 'Update failed');
    } catch (e: any) { toast.error(e?.message || 'Update failed'); }
  };

  const handleMarkLost = async (id: string) => {
    try {
      const res = await api.hubs.sales.updateLead(id, { stage: 'lost' });
      if (res.success) { toast.success('Marked as lost'); void load(); }
      else toast.error(res.error || 'Update failed');
    } catch (e: any) { toast.error(e?.message || 'Update failed'); }
  };

  const tabs = [
    { id: 'pipeline' as const, label: 'Pipeline', icon: Building2 },
    { id: 'heatmap' as const, label: 'Heat Map', icon: TrendingDown },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Workspace</h1>
          <p className="text-sm text-slate-400 mt-1">AI-powered pipeline with deal scoring, risk detection, and next-action recommendations.</p>
        </div>
        <button onClick={() => void load()} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60">
          <RefreshCw className={cx('w-4 h-4', busy && 'animate-spin')} /> Refresh
        </button>
      </div>

      <HubLiveMetrics configs={SALES_INTEGRATIONS} />

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

      {/* ═══ PIPELINE ═══ */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-slate-400">{leads.length} lead{leads.length !== 1 ? 's' : ''}</div>
            <div className="flex-1" />
            <button onClick={handleScoreAll} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> Score All
            </button>
            <button onClick={() => setShowCreate(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Lead
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map(stage => (
              <div key={stage} className={cx('min-w-[280px] flex-shrink-0 bg-slate-800/20 border rounded-xl', STAGE_COLORS[stage] || 'border-slate-700')}>
                <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white capitalize">{stage}</span>
                  <span className="text-xs text-slate-500">{byStage[stage]?.length || 0}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[600px] overflow-y-auto">
                  {(byStage[stage] || []).map(lead => (
                    <div key={lead.id} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className={cx('w-10 h-10 rounded-full border flex flex-col items-center justify-center shrink-0 text-xs', scoreBg(lead.ai_deal_score))}>
                          {lead.ai_deal_score != null ? <span className={cx('font-bold', scoreColor(lead.ai_deal_score))}>{lead.ai_deal_score}</span> : <span className="text-slate-500">—</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">{lead.company_name}</p>
                          {lead.contact_name && <p className="text-xs text-slate-400 truncate">{lead.contact_name}</p>}
                        </div>
                      </div>
                      {lead.deal_value != null && <p className="text-xs text-emerald-400 font-semibold">{formatValue(lead.deal_value, lead.currency)}</p>}
                      {lead.ai_risk_reason && <p className="text-xs text-amber-400">⚠ {lead.ai_risk_reason}</p>}
                      {lead.ai_next_action && <p className="text-xs text-cyan-400">→ {lead.ai_next_action}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">{relativeTime(lead.last_activity_at || lead.created_at)}</span>
                        <div className="flex gap-1">
                          {!lead.ai_scored_at && <button onClick={() => handleScore(lead.id)} disabled={busy} className="p-1 text-purple-400 hover:bg-purple-500/10 rounded disabled:opacity-40" title="Score"><Sparkles className="w-3 h-3" /></button>}
                          {stage !== 'won' && stage !== 'lost' && <button onClick={() => handleAdvanceStage(lead)} className="p-1 text-cyan-400 hover:bg-cyan-500/10 rounded" title="Advance"><ChevronRight className="w-3 h-3" /></button>}
                          {stage !== 'won' && stage !== 'lost' && <button onClick={() => handleMarkLost(lead.id)} className="p-1 text-rose-400 hover:bg-rose-500/10 rounded" title="Mark Lost"><X className="w-3 h-3" /></button>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(byStage[stage] || []).length === 0 && <p className="text-xs text-slate-500 text-center py-4">No leads</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ HEAT MAP ═══ */}
      {tab === 'heatmap' && (
        <div className="space-y-4">
          {coldDeals.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <TrendingDown className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
              <p className="text-emerald-400 text-sm font-semibold">No cold deals — your pipeline is healthy!</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-700 text-slate-400 text-xs">
                  <th className="px-4 py-3 text-left">Company</th><th className="px-4 py-3 text-left">Contact</th><th className="px-4 py-3 text-left">Stage</th><th className="px-4 py-3 text-right">Deal Value</th><th className="px-4 py-3 text-right">Inactive</th><th className="px-4 py-3 text-left">Risk</th><th className="px-4 py-3"></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-800/60">
                  {coldDeals.map(l => {
                    const days = daysAgo(l.last_activity_at || l.created_at);
                    const rowBg = days >= 14 ? 'bg-rose-500/5' : days >= 7 ? 'bg-amber-500/5' : '';
                    return (
                      <tr key={l.id} className={rowBg}>
                        <td className="px-4 py-3 text-white font-medium">{l.company_name}</td>
                        <td className="px-4 py-3 text-slate-400">{l.contact_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-300 capitalize">{l.stage}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{formatValue(l.deal_value, l.currency) || '—'}</td>
                        <td className={cx('px-4 py-3 text-right font-semibold', days >= 14 ? 'text-rose-400' : days >= 7 ? 'text-amber-400' : 'text-slate-400')}>{days}d</td>
                        <td className="px-4 py-3 text-amber-400 text-xs max-w-[200px] truncate">{l.ai_risk_reason || '—'}</td>
                        <td className="px-4 py-3"><button onClick={() => handleScore(l.id)} disabled={busy} className="px-2 py-1 rounded text-xs text-purple-400 hover:bg-purple-500/10 disabled:opacity-40">Re-score</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ SETTINGS ═══ */}
      {tab === 'settings' && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 max-w-xl space-y-6">
          <h3 className="text-lg font-semibold text-white">Pipeline Settings</h3>
          <div>
            <label className="text-sm text-slate-300 block mb-2">Days inactive to flag as cold: <span className="font-semibold text-white">{coldThreshold}</span></label>
            <input type="range" min={1} max={30} value={coldThreshold} onChange={e => setColdThreshold(Number(e.target.value))} className="w-full accent-purple-500" />
          </div>
        </div>
      )}

      {showCreate && <CreateLeadDrawer onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}
    </div>
  );
}

function CreateLeadDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ company_name: '', contact_name: '', contact_email: '', contact_phone: '', stage: 'new', deal_value: '', tags: '', notes: '' });

  const handleSubmit = async () => {
    if (!form.company_name.trim()) { toast.error('Company name is required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.sales.createLead({
        company_name: form.company_name.trim(), contact_name: form.contact_name.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined, contact_phone: form.contact_phone.trim() || undefined,
        stage: form.stage as any, deal_value: form.deal_value ? Number(form.deal_value) : undefined,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        notes: form.notes ? { text: form.notes } : undefined,
      } as any);
      if (res.success) { toast.success('Lead created'); onCreated(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Add Lead</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="text-sm text-slate-300 block mb-1">Company Name *</label><input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Contact Name</label><input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
            <div><label className="text-sm text-slate-300 block mb-1">Email</label><input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Stage</label><select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">{STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select></div>
            <div><label className="text-sm text-slate-300 block mb-1">Deal Value (INR)</label><input type="number" value={form.deal_value} onChange={e => setForm(f => ({ ...f, deal_value: e.target.value }))} placeholder="500000" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          </div>
          <div><label className="text-sm text-slate-300 block mb-1">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y" /></div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Lead
          </button>
        </div>
      </div>
    </div>
  );
}
