import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ShieldCheck, FileSearch, RefreshCw, Plus, X, Check, Loader2, Sparkles, AlertTriangle, Clock,
  Fingerprint, UserCheck, Trash2, Eye, FileOutput, AlertOctagon, FileBarChart, Bell, BellOff,
  IndianRupee, Send, RotateCw, Globe,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { HubDeadline, HubEvidence } from '../../types';
import type { ConsentRecord, DataPrincipalRequest, DpdpDashboard } from '../../lib/api/dpdp';
import { filingsApi } from '../../lib/api/filings';
import { complianceApi } from '../../lib/api/governance';
import type { FilingDeadline, FilingSubmission, FilingAlert, FilingDashboard } from '../../lib/api/filings';

type TabId = 'calendar' | 'posture' | 'evidence' | 'dpdp' | 'gdpr' | 'filings';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function statusBadge(s: string) {
  const m: Record<string, string> = {
    upcoming: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    in_progress: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    overdue: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    waived: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    collected: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    reviewed: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    accepted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[s] || m.upcoming;
}

function daysUntil(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  return diff;
}

function daysLabel(dateStr: string) {
  const d = daysUntil(dateStr);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Due today';
  return `${d}d left`;
}

function daysColor(dateStr: string) {
  const d = daysUntil(dateStr);
  if (d < 0) return 'text-rose-400';
  if (d <= 7) return 'text-amber-400';
  return 'text-emerald-400';
}

export default function ComplianceHubPage() {
  const [tab, setTab] = useState<TabId>('calendar');
  const [busy, setBusy] = useState(false);
  const [deadlines, setDeadlines] = useState<HubDeadline[]>([]);
  const [evidence, setEvidence] = useState<HubEvidence[]>([]);
  const [posture, setPosture] = useState<{ score: number; total: number; completed: number; overdue: number; upcoming: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAddDeadline, setShowAddDeadline] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [newDeadline, setNewDeadline] = useState({ title: '', regulation: '', description: '', due_date: '', recurring: '' });
  const [newEvidence, setNewEvidence] = useState({ title: '', control_area: '', source: '', deadline_id: '' });

  // DPDP state
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [dprRequests, setDprRequests] = useState<DataPrincipalRequest[]>([]);
  const [dpdpDash, setDpdpDash] = useState<DpdpDashboard | null>(null);
  const [dpdpSubTab, setDpdpSubTab] = useState<'overview' | 'consents' | 'requests' | 'scorecard'>('overview');
  const [exportingDpdp, setExportingDpdp] = useState(false);
  const [exportDone, setExportDone] = useState<{ id: string; url: string } | null>(null);

  // GDPR state
  const [exportingGdpr, setExportingGdpr] = useState(false);
  const [gdprExportDone, setGdprExportDone] = useState<{ id: string; url: string } | null>(null);

  // Filings state
  const [filingDeadlines, setFilingDeadlines] = useState<FilingDeadline[]>([]);
  const [filingSubmissions, setFilingSubmissions] = useState<FilingSubmission[]>([]);
  const [filingAlerts, setFilingAlerts] = useState<FilingAlert[]>([]);
  const [filingDash, setFilingDash] = useState<FilingDashboard | null>(null);
  const [filingSubTab, setFilingSubTab] = useState<'overview' | 'submissions' | 'deadlines' | 'alerts'>('overview');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [dRes, eRes, pRes, conRes, reqRes, dashRes] = await Promise.all([
        api.hubs.compliance.listDeadlines(),
        api.hubs.compliance.listEvidence(),
        api.hubs.compliance.getPosture(),
        api.dpdp.listConsents(),
        api.dpdp.listRequests(),
        api.dpdp.getDashboard(),
      ]);
      if (dRes.data) setDeadlines(dRes.data);
      if (eRes.data) setEvidence(eRes.data);
      if (pRes.data) setPosture(pRes.data);
      if (conRes.data) setConsents(conRes.data);
      if (reqRes.data) setDprRequests(reqRes.data);
      if (dashRes.data) setDpdpDash(dashRes.data);

      // Filing data
      const [fdRes, fsRes, faRes, fdashRes] = await Promise.all([
        filingsApi.listDeadlines(),
        filingsApi.listSubmissions(),
        filingsApi.listAlerts(true),
        filingsApi.getDashboard(),
      ]);
      if (fdRes.data) setFilingDeadlines(fdRes.data);
      if (fsRes.data) setFilingSubmissions(fsRes.data);
      if (faRes.data) setFilingAlerts(faRes.data);
      if (fdashRes.data) setFilingDash(fdashRes.data);
    } catch { toast.error('Failed to load compliance data'); }
    setBusy(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredDeadlines = useMemo(() => {
    let items = [...deadlines].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    if (statusFilter !== 'all') items = items.filter(d => d.status === statusFilter);
    return items;
  }, [deadlines, statusFilter]);

  const filteredEvidence = useMemo(() => {
    let items = [...evidence];
    if (statusFilter !== 'all') items = items.filter(e => e.status === statusFilter);
    return items;
  }, [evidence, statusFilter]);

  async function handleGenerateChecklist(id: string) {
    setBusy(true);
    try {
      const res = await api.hubs.compliance.generateChecklist(id);
      if (res.data) {
        setDeadlines(prev => prev.map(d => d.id === id ? res.data! : d));
        toast.success('AI checklist generated');
      }
    } catch { toast.error('Checklist generation failed'); }
    setBusy(false);
  }

  async function handleCreateDeadline() {
    if (!newDeadline.title || !newDeadline.due_date) return;
    setBusy(true);
    try {
      const res = await api.hubs.compliance.createDeadline(newDeadline);
      if (res.data) { setDeadlines(prev => [res.data!, ...prev]); setShowAddDeadline(false); setNewDeadline({ title: '', regulation: '', description: '', due_date: '', recurring: '' }); toast.success('Deadline created'); }
    } catch { toast.error('Failed to create deadline'); }
    setBusy(false);
  }

  async function handleCreateEvidence() {
    if (!newEvidence.title) return;
    setBusy(true);
    try {
      const res = await api.hubs.compliance.createEvidence(newEvidence);
      if (res.data) { setEvidence(prev => [res.data!, ...prev]); setShowAddEvidence(false); setNewEvidence({ title: '', control_area: '', source: '', deadline_id: '' }); toast.success('Evidence added'); }
    } catch { toast.error('Failed to add evidence'); }
    setBusy(false);
  }

  async function handleUpdateDeadlineStatus(id: string, status: string) {
    try {
      const res = await api.hubs.compliance.updateDeadline(id, { status });
      if (res.data) { setDeadlines(prev => prev.map(d => d.id === id ? res.data! : d)); toast.success('Status updated'); }
    } catch { toast.error('Update failed'); }
  }

  async function handleUpdateEvidenceStatus(id: string, status: string) {
    try {
      const res = await api.hubs.compliance.updateEvidence(id, { status });
      if (res.data) { setEvidence(prev => prev.map(e => e.id === id ? res.data! : e)); toast.success('Status updated'); }
    } catch { toast.error('Update failed'); }
  }

  async function handleWithdrawConsent(id: string) {
    setBusy(true);
    try {
      const res = await api.dpdp.withdrawConsent(id, 'Manual withdrawal from compliance hub');
      if (res.data) {
        setConsents(prev => prev.map(c => c.id === id ? { ...c, status: 'withdrawn' as const, withdrawn_at: new Date().toISOString() } : c));
        toast.success('Consent withdrawn');
        // Refresh dashboard score
        const d = await api.dpdp.getDashboard();
        if (d.data) setDpdpDash(d.data);
      }
    } catch { toast.error('Withdrawal failed'); }
    setBusy(false);
  }

  async function handleUpdateDpr(id: string, status: string) {
    setBusy(true);
    try {
      const res = await api.dpdp.updateRequest(id, { status });
      if (res.data) {
        setDprRequests(prev => prev.map(r => r.id === id ? res.data! : r));
        toast.success('Request updated');
      }
    } catch { toast.error('Update failed'); }
    setBusy(false);
  }

  const overdueRequests = useMemo(() => dprRequests.filter(r => (r.status === 'pending' || r.status === 'in_progress') && new Date(r.due_at) < new Date()), [dprRequests]);

  async function handleSeedFilings() {
    setBusy(true);
    try {
      const res = await filingsApi.seedDeadlines();
      if (res.data) { toast.success(`Seeded ${res.data.seeded} statutory filings`); load(); }
    } catch { toast.error('Already seeded or seed failed'); }
    setBusy(false);
  }

  async function handleGenerateSubmissions() {
    setBusy(true);
    try {
      const res = await filingsApi.generateSubmissions();
      if (res.data) { toast.success(`Generated ${res.data.generated} submissions`); load(); }
    } catch { toast.error('Generation failed'); }
    setBusy(false);
  }

  async function handleUpdateSubmission(id: string, data: Partial<FilingSubmission>) {
    setBusy(true);
    try {
      const res = await filingsApi.updateSubmission(id, data);
      if (res.data) {
        setFilingSubmissions(prev => prev.map(s => s.id === id ? res.data! : s));
        toast.success('Submission updated');
        // refresh dashboard
        const d = await filingsApi.getDashboard();
        if (d.data) setFilingDash(d.data);
      }
    } catch { toast.error('Update failed'); }
    setBusy(false);
  }

  async function handleMarkAlertRead(id: string) {
    try {
      await filingsApi.markAlertRead(id);
      setFilingAlerts(prev => prev.filter(a => a.id !== id));
    } catch { toast.error('Failed to dismiss'); }
  }

  async function handleMarkAllAlertsRead() {
    try {
      await filingsApi.markAllAlertsRead();
      setFilingAlerts([]);
      toast.success('All alerts dismissed');
    } catch { toast.error('Failed'); }
  }

  const filteredSubmissions = useMemo(() => {
    let items = [...filingSubmissions];
    if (statusFilter !== 'all') items = items.filter(s => s.status === statusFilter);
    return items.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [filingSubmissions, statusFilter]);

  const overdueSubmissions = useMemo(() => filingSubmissions.filter(s => s.status === 'overdue'), [filingSubmissions]);

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'posture', label: 'Posture', icon: ShieldCheck },
    { id: 'evidence', label: 'Evidence', icon: FileSearch },
    { id: 'dpdp', label: 'DPDP', icon: Fingerprint },
    { id: 'gdpr', label: 'GDPR', icon: Globe },
    { id: 'filings', label: 'Filings', icon: FileBarChart },
  ];

  const postureColor = (s: number) => s >= 80 ? 'text-emerald-400' : s >= 50 ? 'text-amber-400' : 'text-rose-400';
  const postureRing = (s: number) => s >= 80 ? 'ring-emerald-500/40' : s >= 50 ? 'ring-amber-500/40' : 'ring-rose-500/40';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Workspace</h1>
          <p className="text-sm text-slate-400 mt-1">Regulatory deadlines, posture scoring &amp; evidence collection</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={busy} className="p-2 rounded-lg bg-slate-800/60 text-slate-300 hover:text-white border border-slate-700/50 transition-colors">
            <RefreshCw className={cx('h-4 w-4', busy && 'animate-spin')} />
          </button>
          {tab === 'calendar' && (
            <button onClick={() => setShowAddDeadline(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors">
              <Plus className="h-4 w-4" /> Add Deadline
            </button>
          )}
          {tab === 'evidence' && (
            <button onClick={() => setShowAddEvidence(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors">
              <Plus className="h-4 w-4" /> Add Evidence
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/40 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setStatusFilter('all'); }}
            className={cx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.id ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Calendar Tab */}
      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {['all', 'upcoming', 'in_progress', 'completed', 'overdue', 'waived'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  statusFilter === s ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:text-slate-200')}>
                {s === 'all' ? 'All' : s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
              </button>
            ))}
          </div>

          {filteredDeadlines.length === 0 ? (
            <div className="text-center py-16 text-slate-500">No deadlines found</div>
          ) : (
            <div className="space-y-3">
              {filteredDeadlines.map(d => (
                <div key={d.id} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600/60 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">{d.title}</h3>
                        {d.regulation && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">{d.regulation}</span>}
                        <span className={cx('text-xs px-2 py-0.5 rounded-full border', statusBadge(d.status))}>{d.status.replace('_', ' ')}</span>
                      </div>
                      {d.description && <p className="text-sm text-slate-400 mb-2 line-clamp-2">{d.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Due {new Date(d.due_date).toLocaleDateString()}</span>
                        <span className={cx('font-medium', daysColor(d.due_date))}><Clock className="h-3 w-3 inline mr-1" />{daysLabel(d.due_date)}</span>
                        {d.recurring && <span>Recurring: {d.recurring}</span>}
                      </div>
                      {/* AI Checklist */}
                      {d.ai_checklist && d.ai_checklist.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <span className="text-xs text-slate-500 font-medium">AI Checklist</span>
                          {d.ai_checklist.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className={cx('h-4 w-4 rounded flex items-center justify-center text-xs', item.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-500')}>
                                {item.done && <Check className="h-3 w-3" />}
                              </span>
                              <span className={cx(item.done ? 'text-slate-500 line-through' : 'text-slate-300')}>{item.item}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleGenerateChecklist(d.id)} disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 text-xs font-medium transition-colors">
                        <Sparkles className="h-3.5 w-3.5" /> Checklist
                      </button>
                      {d.status !== 'completed' && (
                        <button onClick={() => handleUpdateDeadlineStatus(d.id, 'completed')}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium transition-colors">
                          <Check className="h-3.5 w-3.5" /> Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Posture Tab */}
      {tab === 'posture' && (
        <div className="space-y-6">
          {posture && (
            <>
              <div className="flex justify-center">
                <div className={cx('w-40 h-40 rounded-full ring-4 flex flex-col items-center justify-center', postureRing(posture.score))}>
                  <span className={cx('text-4xl font-bold', postureColor(posture.score))}>{posture.score}</span>
                  <span className="text-xs text-slate-400 mt-1">Posture Score</span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total', value: posture.total, color: 'text-white' },
                  { label: 'Completed', value: posture.completed, color: 'text-emerald-400' },
                  { label: 'Upcoming', value: posture.upcoming, color: 'text-blue-400' },
                  { label: 'Overdue', value: posture.overdue, color: 'text-rose-400' },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <div className={cx('text-2xl font-bold', s.color)}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Overdue items */}
              {deadlines.filter(d => d.status === 'overdue').length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-rose-400 mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Overdue Items</h3>
                  <div className="space-y-2">
                    {deadlines.filter(d => d.status === 'overdue').map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                        <div>
                          <span className="text-sm font-medium text-white">{d.title}</span>
                          {d.regulation && <span className="ml-2 text-xs text-purple-300">{d.regulation}</span>}
                        </div>
                        <span className="text-xs text-rose-400 font-medium">{daysLabel(d.due_date)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!posture && <div className="text-center py-16 text-slate-500">Loading posture data...</div>}
        </div>
      )}

      {/* Evidence Tab */}
      {tab === 'evidence' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {['all', 'collected', 'reviewed', 'accepted', 'rejected'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  statusFilter === s ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:text-slate-200')}>
                {s === 'all' ? 'All' : s.replace(/^\w/, c => c.toUpperCase())}
              </button>
            ))}
          </div>

          {filteredEvidence.length === 0 ? (
            <div className="text-center py-16 text-slate-500">No evidence found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500 uppercase">
                    <th className="pb-3 pr-4">Title</th>
                    <th className="pb-3 pr-4">Control Area</th>
                    <th className="pb-3 pr-4">Source</th>
                    <th className="pb-3 pr-4">Collected</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvidence.map(e => (
                    <tr key={e.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                      <td className="py-3 pr-4 font-medium text-white">{e.title}</td>
                      <td className="py-3 pr-4 text-slate-400">{e.control_area || '—'}</td>
                      <td className="py-3 pr-4 text-slate-400">{e.source || '—'}</td>
                      <td className="py-3 pr-4 text-slate-500">{e.collected_at ? new Date(e.collected_at).toLocaleDateString() : '—'}</td>
                      <td className="py-3 pr-4">
                        <span className={cx('text-xs px-2 py-0.5 rounded-full border', statusBadge(e.status))}>{e.status}</span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {e.status !== 'accepted' && (
                            <button onClick={() => handleUpdateEvidenceStatus(e.id, 'accepted')}
                              className="p-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 transition-colors" title="Accept">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {e.status !== 'rejected' && (
                            <button onClick={() => handleUpdateEvidenceStatus(e.id, 'rejected')}
                              className="p-1.5 rounded-lg bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 transition-colors" title="Reject">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* DPDP Tab */}
      {tab === 'dpdp' && (
        <div className="space-y-6">
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-slate-800/40 rounded-lg p-1 w-fit">
            {([['overview', 'Overview'], ['consents', 'Consents'], ['requests', 'Requests'], ['scorecard', 'Scorecard']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setDpdpSubTab(id)}
                className={cx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  dpdpSubTab === id ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200')}>
                {label}
              </button>
            ))}
          </div>

          {/* DPDP Overview */}
          {dpdpSubTab === 'overview' && dpdpDash && (
            <div className="space-y-6">
              {/* One-click DPDP export */}
              <div className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">DPDP Compliance Export</p>
                  <p className="text-xs text-slate-400 mt-0.5">Download your audit-ready DPDP compliance report — timestamped, auto-populated from activity history.</p>
                </div>
                {exportDone ? (
                  <a
                    href={exportDone.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                  >
                    <FileOutput className="w-3.5 h-3.5" /> Download
                  </a>
                ) : (
                  <button
                    disabled={exportingDpdp}
                    onClick={async () => {
                      setExportingDpdp(true);
                      try {
                        const res = await complianceApi.requestExport({ export_type: 'dpdp' });
                        const id = (res as any)?.id || (res as any)?.data?.id;
                        if (id) {
                          setExportDone({ id, url: `/api/compliance/exports/${id}/download` });
                          toast.success('DPDP report ready — click Download');
                        } else {
                          toast.error('Export failed. Try again.');
                        }
                      } catch {
                        toast.error('Export failed. Try again.');
                      } finally {
                        setExportingDpdp(false);
                      }
                    }}
                    className="shrink-0 flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors disabled:opacity-60"
                  >
                    {exportingDpdp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5" />}
                    {exportingDpdp ? 'Generating…' : 'Export PDF'}
                  </button>
                )}
              </div>

              {/* Compliance Score */}
              <div className="flex justify-center">
                <div className={cx('w-36 h-36 rounded-full ring-4 flex flex-col items-center justify-center',
                  dpdpDash.compliance_score >= 80 ? 'ring-emerald-500/40' : dpdpDash.compliance_score >= 50 ? 'ring-amber-500/40' : 'ring-rose-500/40')}>
                  <span className={cx('text-3xl font-bold', dpdpDash.compliance_score >= 80 ? 'text-emerald-400' : dpdpDash.compliance_score >= 50 ? 'text-amber-400' : 'text-rose-400')}>
                    {dpdpDash.compliance_score}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">DPDP Score</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Active Consents', value: dpdpDash.consent_summary.active, color: 'text-emerald-400', icon: UserCheck },
                  { label: 'Expiring Soon', value: dpdpDash.consent_summary.expiring_soon, color: 'text-amber-400', icon: Clock },
                  { label: 'Pending Requests', value: dpdpDash.request_summary.pending + dpdpDash.request_summary.in_progress, color: 'text-blue-400', icon: Eye },
                  { label: 'Overdue', value: dpdpDash.request_summary.overdue, color: 'text-rose-400', icon: AlertOctagon },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <s.icon className={cx('h-5 w-5 mx-auto mb-2', s.color)} />
                    <div className={cx('text-2xl font-bold', s.color)}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Consent breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Consent Status</h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Active', value: dpdpDash.consent_summary.active, color: 'bg-emerald-500' },
                      { label: 'Withdrawn', value: dpdpDash.consent_summary.withdrawn, color: 'bg-amber-500' },
                      { label: 'Expired', value: dpdpDash.consent_summary.expired, color: 'bg-rose-500' },
                    ].map(s => (
                      <div key={s.label} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cx('w-2 h-2 rounded-full', s.color)} />
                          <span className="text-slate-300">{s.label}</span>
                        </div>
                        <span className="text-white font-medium">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Data Principal Requests</h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Pending', value: dpdpDash.request_summary.pending, color: 'bg-blue-500' },
                      { label: 'In Progress', value: dpdpDash.request_summary.in_progress, color: 'bg-cyan-500' },
                      { label: 'Completed', value: dpdpDash.request_summary.completed, color: 'bg-emerald-500' },
                      { label: 'Escalated', value: dpdpDash.request_summary.escalated, color: 'bg-rose-500' },
                    ].map(s => (
                      <div key={s.label} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className={cx('w-2 h-2 rounded-full', s.color)} />
                          <span className="text-slate-300">{s.label}</span>
                        </div>
                        <span className="text-white font-medium">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Overdue alert */}
              {overdueRequests.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-rose-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> 72h Deadline Breaches — DPDP Act Sec 11
                  </h3>
                  <div className="space-y-2">
                    {overdueRequests.map(r => (
                      <div key={r.id} className="flex items-center justify-between">
                        <div className="text-sm">
                          <span className="text-white font-medium capitalize">{r.request_type}</span>
                          <span className="text-slate-400 ml-2">{r.principal_email || r.principal_id}</span>
                        </div>
                        <span className="text-xs text-rose-400 font-medium">{daysLabel(r.due_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Retention policies count */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Retention Policies</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Active data lifecycle rules</p>
                </div>
                <span className="text-2xl font-bold text-cyan-400">{dpdpDash.retention_policies}</span>
              </div>
            </div>
          )}

          {/* DPDP Consents */}
          {dpdpSubTab === 'consents' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {['all', 'active', 'withdrawn', 'expired'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={cx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      statusFilter === s ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:text-slate-200')}>
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {consents.filter(c => statusFilter === 'all' || c.status === statusFilter).length === 0 ? (
                <div className="text-center py-16 text-slate-500">No consent records found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500 uppercase">
                        <th className="pb-3 pr-4">Principal</th>
                        <th className="pb-3 pr-4">Purpose</th>
                        <th className="pb-3 pr-4">Legal Basis</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4">Granted</th>
                        <th className="pb-3 pr-4">Expires</th>
                        <th className="pb-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consents.filter(c => statusFilter === 'all' || c.status === statusFilter).map(c => (
                        <tr key={c.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{c.principal_email || c.principal_id}</div>
                            <div className="text-xs text-slate-500 capitalize">{c.principal_type}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">{c.purpose}</td>
                          <td className="py-3 pr-4 text-slate-400 text-xs capitalize">{c.legal_basis.replace('_', ' ')}</td>
                          <td className="py-3 pr-4">
                            <span className={cx('text-xs px-2 py-0.5 rounded-full border', statusBadge(c.status === 'active' ? 'completed' : c.status === 'withdrawn' ? 'overdue' : 'waived'))}>
                              {c.status}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-slate-500 text-xs">{new Date(c.granted_at).toLocaleDateString()}</td>
                          <td className="py-3 pr-4 text-slate-500 text-xs">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                          <td className="py-3 text-right">
                            {c.status === 'active' && (
                              <button onClick={() => handleWithdrawConsent(c.id)} disabled={busy}
                                className="p-1.5 rounded-lg bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 transition-colors" title="Withdraw Consent">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* DPDP Requests */}
          {dpdpSubTab === 'requests' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {['all', 'pending', 'in_progress', 'completed', 'escalated', 'rejected'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={cx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      statusFilter === s ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:text-slate-200')}>
                    {s === 'all' ? 'All' : s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
                  </button>
                ))}
              </div>

              {dprRequests.filter(r => statusFilter === 'all' || r.status === statusFilter).length === 0 ? (
                <div className="text-center py-16 text-slate-500">No data principal requests</div>
              ) : (
                <div className="space-y-3">
                  {dprRequests.filter(r => statusFilter === 'all' || r.status === statusFilter).map(r => {
                    const isOverdue = (r.status === 'pending' || r.status === 'in_progress') && new Date(r.due_at) < new Date();
                    return (
                      <div key={r.id} className={cx('bg-slate-800/30 border rounded-xl p-4 transition-colors',
                        isOverdue ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-700/50 hover:border-slate-600/60')}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 uppercase">{r.request_type}</span>
                              <span className={cx('text-xs px-2 py-0.5 rounded-full border',
                                statusBadge(r.status === 'completed' ? 'completed' : r.status === 'escalated' ? 'overdue' : r.status === 'rejected' ? 'rejected' : 'in_progress'))}>
                                {r.status.replace('_', ' ')}
                              </span>
                              {isOverdue && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">OVERDUE</span>}
                              <span className={cx('text-xs px-1.5 py-0.5 rounded font-medium',
                                r.priority === 'urgent' ? 'bg-rose-500/15 text-rose-300' : r.priority === 'high' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700/50 text-slate-400')}>
                                {r.priority}
                              </span>
                            </div>
                            <div className="text-sm text-white font-medium">{r.principal_email || r.principal_id}</div>
                            {r.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{r.description}</p>}
                            <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
                              <span className="capitalize">{r.principal_type}</span>
                              <span>Submitted {new Date(r.created_at).toLocaleDateString()}</span>
                              <span className={cx('font-medium', isOverdue ? 'text-rose-400' : daysColor(r.due_at))}>
                                <Clock className="h-3 w-3 inline mr-1" />{daysLabel(r.due_at)}
                              </span>
                              {r.submitted_via && <span>via {r.submitted_via}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {(r.status === 'pending' || r.status === 'escalated') && (
                              <button onClick={() => handleUpdateDpr(r.id, 'in_progress')}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-medium transition-colors">
                                <Eye className="h-3.5 w-3.5" /> Start
                              </button>
                            )}
                            {r.status === 'in_progress' && (
                              <button onClick={() => handleUpdateDpr(r.id, 'completed')}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium transition-colors">
                                <Check className="h-3.5 w-3.5" /> Complete
                              </button>
                            )}
                            {r.request_type === 'erasure' && r.erasure_receipt && (
                              <span className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400" title={`Receipt: ${r.erasure_receipt}`}>
                                <FileOutput className="h-3.5 w-3.5" /> Receipt
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DPDPA Scorecard */}
          {dpdpSubTab === 'scorecard' && (
            <div className="space-y-6">
              {/* Score hero */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">DPDP Act 2023 — Compliance Scorecard</h3>
                <div className="flex items-center gap-8">
                  <div className={cx('w-28 h-28 rounded-full ring-4 flex flex-col items-center justify-center shrink-0',
                    (dpdpDash?.compliance_score ?? 0) >= 80 ? 'ring-emerald-500/40' : (dpdpDash?.compliance_score ?? 0) >= 50 ? 'ring-amber-500/40' : 'ring-rose-500/40')}>
                    <span className={cx('text-3xl font-bold',
                      (dpdpDash?.compliance_score ?? 0) >= 80 ? 'text-emerald-400' : (dpdpDash?.compliance_score ?? 0) >= 50 ? 'text-amber-400' : 'text-rose-400')}>
                      {dpdpDash?.compliance_score ?? '—'}
                    </span>
                    <span className="text-xs text-slate-500 mt-1">/ 100</span>
                  </div>
                  <div className="flex-1 space-y-3">
                    {[
                      { label: 'Active consent coverage', value: dpdpDash ? `${dpdpDash.consent_summary.active} active` : '—', ok: (dpdpDash?.consent_summary.active ?? 0) > 0 },
                      { label: 'DPR response SLA (72h)', value: (dpdpDash?.request_summary.overdue ?? 0) === 0 ? 'No breaches' : `${dpdpDash?.request_summary.overdue} overdue`, ok: (dpdpDash?.request_summary.overdue ?? 0) === 0 },
                      { label: 'Retention policies', value: `${dpdpDash?.retention_policies ?? 0} active`, ok: (dpdpDash?.retention_policies ?? 0) > 0 },
                      { label: 'Consent expiry risk', value: (dpdpDash?.consent_summary.expiring_soon ?? 0) > 0 ? `${dpdpDash?.consent_summary.expiring_soon} expiring in 30d` : 'None', ok: (dpdpDash?.consent_summary.expiring_soon ?? 0) === 0 },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {item.ok
                            ? <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            : <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />}
                          <span className="text-sm text-slate-300">{item.label}</span>
                        </div>
                        <span className={cx('text-sm font-medium', item.ok ? 'text-emerald-400' : 'text-rose-400')}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Principals breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-cyan-400" /> Data Principals
                  </h3>
                  {consents.length === 0 ? (
                    <p className="text-sm text-slate-500">No consent records yet</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(
                        consents.reduce<Record<string, number>>((acc, c) => {
                          acc[c.principal_type] = (acc[c.principal_type] || 0) + 1;
                          return acc;
                        }, {}),
                      ).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300 capitalize">{type}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                              <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${Math.round((count / consents.length) * 100)}%` }} />
                            </div>
                            <span className="text-white font-medium w-6 text-right">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <FileSearch className="h-4 w-4 text-violet-400" /> DPR Throughput
                  </h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Pending', value: dpdpDash?.request_summary.pending ?? 0, color: 'bg-blue-500' },
                      { label: 'In Progress', value: dpdpDash?.request_summary.in_progress ?? 0, color: 'bg-cyan-500' },
                      { label: 'Completed', value: dpdpDash?.request_summary.completed ?? 0, color: 'bg-emerald-500' },
                      { label: 'Escalated / Overdue', value: (dpdpDash?.request_summary.escalated ?? 0) + (dpdpDash?.request_summary.overdue ?? 0), color: 'bg-rose-500' },
                    ].map(s => {
                      const total = dpdpDash?.request_summary.total || 1;
                      return (
                        <div key={s.label} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className={cx('w-2 h-2 rounded-full shrink-0', s.color)} />
                            <span className="text-slate-300">{s.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                              <div className={cx('h-full rounded-full', s.color)} style={{ width: `${Math.round((s.value / total) * 100)}%` }} />
                            </div>
                            <span className="text-white font-medium w-4 text-right">{s.value}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Breach incidents */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-rose-400" /> DPDP Act Sec 11 — 72h Deadline Breaches
                </h3>
                {overdueRequests.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <Check className="h-4 w-4" /> No active deadline breaches — fully compliant
                  </div>
                ) : (
                  <div className="space-y-2">
                    {overdueRequests.map(r => (
                      <div key={r.id} className="flex items-center justify-between py-1 border-b border-slate-700/40 last:border-0">
                        <div>
                          <span className="text-sm text-white font-medium capitalize">{r.request_type}</span>
                          <span className="text-xs text-slate-400 ml-2">{r.principal_email || r.principal_id}</span>
                          <span className="text-xs text-slate-500 ml-2 capitalize">{r.principal_type}</span>
                        </div>
                        <span className="text-xs font-medium text-rose-400">{daysLabel(r.due_at)}</span>
                      </div>
                    ))}
                    <p className="text-xs text-slate-500 mt-2">
                      {overdueRequests.length} breach{overdueRequests.length > 1 ? 'es' : ''} — may attract penalties under DPDP Act Schedule II
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GDPR Tab */}
      {tab === 'gdpr' && (
        <div className="space-y-6">
          {/* One-click GDPR export */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">GDPR Compliance Export</p>
                <p className="text-xs text-slate-400 mt-0.5">Download your audit-ready GDPR report — timestamped, auto-populated from activity history, data subject requests, and processing records.</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {gdprExportDone && (
                  <a
                    href={gdprExportDone.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                  >
                    <FileOutput className="w-3.5 h-3.5" /> Download
                  </a>
                )}
                <button
                  disabled={exportingGdpr}
                  onClick={async () => {
                    setExportingGdpr(true);
                    setGdprExportDone(null);
                    try {
                      const res = await complianceApi.requestExport({ export_type: 'gdpr' });
                      if (res?.data?.id) {
                        setGdprExportDone({ id: res.data.id, url: `/api/compliance/exports/${res.data.id}/download` });
                        toast.success('GDPR report ready — click Download');
                      }
                    } catch {
                      toast.error('Failed to generate GDPR export');
                    } finally {
                      setExportingGdpr(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
                >
                  {exportingGdpr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileOutput className="w-3.5 h-3.5" />}
                  {exportingGdpr ? 'Generating…' : 'Export GDPR Report'}
                </button>
              </div>
            </div>
          </div>

          {/* GDPR article summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { article: 'Art. 15', label: 'Right of access', color: 'text-blue-400' },
              { article: 'Art. 17', label: 'Right to erasure', color: 'text-rose-400' },
              { article: 'Art. 20', label: 'Data portability', color: 'text-purple-400' },
              { article: 'Art. 22', label: 'Automated decisions', color: 'text-amber-400' },
              { article: 'Art. 30', label: 'Processing records', color: 'text-emerald-400' },
              { article: 'Art. 35', label: 'DPIAs', color: 'text-cyan-400' },
            ].map((item) => (
              <div key={item.article} className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4">
                <p className={`text-xs font-semibold ${item.color}`}>{item.article}</p>
                <p className="text-sm text-white mt-1">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5">
            <p className="text-sm font-semibold text-white mb-1">Data Subject Requests</p>
            <p className="text-xs text-slate-400">Submit and track erasure, access, and portability requests. All requests logged to the immutable audit trail.</p>
            <p className="mt-3 text-xs text-slate-500 italic">No open requests. Use the GDPR export to generate a full audit report.</p>
          </div>
        </div>
      )}

      {/* Filings Tab */}
      {tab === 'filings' && (
        <div className="space-y-6">
          {/* Sub-tabs */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1 bg-slate-800/40 rounded-lg p-1 w-fit">
              {([['overview', 'Overview'], ['submissions', 'Submissions'], ['deadlines', 'Deadlines'], ['alerts', 'Alerts']] as const).map(([id, label]) => (
                <button key={id} onClick={() => { setFilingSubTab(id); setStatusFilter('all'); }}
                  className={cx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    filingSubTab === id ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200')}>
                  {label}
                  {id === 'alerts' && filingAlerts.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px]">{filingAlerts.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {filingDeadlines.length === 0 && (
                <button onClick={handleSeedFilings} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors">
                  <Sparkles className="h-4 w-4" /> Seed India Filings
                </button>
              )}
              {filingDeadlines.length > 0 && (
                <button onClick={handleGenerateSubmissions} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors">
                  <RotateCw className={cx('h-4 w-4', busy && 'animate-spin')} /> Generate Period
                </button>
              )}
            </div>
          </div>

          {/* Filings Overview */}
          {filingSubTab === 'overview' && filingDash && (
            <div className="space-y-6">
              <div className="flex justify-center">
                <div className={cx('w-36 h-36 rounded-full ring-4 flex flex-col items-center justify-center',
                  filingDash.compliance_score >= 80 ? 'ring-emerald-500/40' : filingDash.compliance_score >= 50 ? 'ring-amber-500/40' : 'ring-rose-500/40')}>
                  <span className={cx('text-3xl font-bold', filingDash.compliance_score >= 80 ? 'text-emerald-400' : filingDash.compliance_score >= 50 ? 'text-amber-400' : 'text-rose-400')}>
                    {filingDash.compliance_score}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">Filing Score</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Active Deadlines', value: filingDash.active_deadlines, color: 'text-cyan-400', icon: CalendarDays },
                  { label: 'Pending', value: filingDash.pending, color: 'text-amber-400', icon: Clock },
                  { label: 'Overdue', value: filingDash.overdue, color: 'text-rose-400', icon: AlertOctagon },
                  { label: 'Submitted', value: filingDash.submitted, color: 'text-emerald-400', icon: Check },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <s.icon className={cx('h-5 w-5 mx-auto mb-2', s.color)} />
                    <div className={cx('text-2xl font-bold', s.color)}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Amount filed */}
              {filingDash.total_amount_filed > 0 && (
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Total Amount Filed</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Cumulative statutory payments this period</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <IndianRupee className="h-5 w-5 text-emerald-400" />
                    <span className="text-2xl font-bold text-emerald-400">{filingDash.total_amount_filed.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}

              {/* Unread alerts */}
              {filingDash.unread_alerts > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-amber-400" />
                    <span className="text-sm text-white font-medium">{filingDash.unread_alerts} unread filing alert{filingDash.unread_alerts !== 1 ? 's' : ''}</span>
                  </div>
                  <button onClick={() => { setFilingSubTab('alerts'); }} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">View alerts →</button>
                </div>
              )}

              {/* Overdue filings */}
              {overdueSubmissions.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-rose-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Overdue Filings — Penalties May Apply
                  </h3>
                  <div className="space-y-2">
                    {overdueSubmissions.map(s => (
                      <div key={s.id} className="flex items-center justify-between">
                        <div className="text-sm">
                          <span className="text-white font-medium">{s.filing_deadlines?.title || s.period_label}</span>
                          <span className="text-slate-400 ml-2">{s.period_label}</span>
                        </div>
                        <span className="text-xs text-rose-400 font-medium">{daysLabel(s.due_date)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filingDeadlines.length === 0 && (
                <div className="text-center py-16 text-slate-500">
                  <p>No filing deadlines configured yet.</p>
                  <p className="mt-2 text-xs">Click "Seed India Filings" to populate statutory deadlines.</p>
                </div>
              )}
            </div>
          )}
          {filingSubTab === 'overview' && !filingDash && filingDeadlines.length === 0 && (
            <div className="text-center py-16 text-slate-500">
              <FileBarChart className="h-10 w-10 mx-auto mb-3 text-slate-600" />
              <p>No filing deadlines configured.</p>
              <p className="mt-1 text-xs">Seed your India statutory calendar to get started.</p>
            </div>
          )}

          {/* Submissions list */}
          {filingSubTab === 'submissions' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {['all', 'pending', 'in_progress', 'submitted', 'accepted', 'overdue', 'waived'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={cx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      statusFilter === s ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/40 text-slate-400 border-slate-700/50 hover:text-slate-200')}>
                    {s === 'all' ? 'All' : s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
                  </button>
                ))}
              </div>

              {filteredSubmissions.length === 0 ? (
                <div className="text-center py-16 text-slate-500">No submissions found. Generate submissions for the current period.</div>
              ) : (
                <div className="space-y-3">
                  {filteredSubmissions.map(s => {
                    const isOverdue = s.status === 'overdue';
                    return (
                      <div key={s.id} className={cx('bg-slate-800/30 border rounded-xl p-4 transition-colors',
                        isOverdue ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-700/50 hover:border-slate-600/60')}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-white truncate">{s.filing_deadlines?.title || 'Filing'}</h3>
                              {s.filing_deadlines?.form_name && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">{s.filing_deadlines.form_name}</span>
                              )}
                              <span className={cx('text-xs px-2 py-0.5 rounded-full border', statusBadge(s.status === 'submitted' || s.status === 'accepted' ? 'completed' : s.status))}>{s.status.replace('_', ' ')}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                              <span className="text-slate-300 font-medium">{s.period_label}</span>
                              {s.filing_deadlines?.authority && <span>{s.filing_deadlines.authority}</span>}
                              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Due {new Date(s.due_date).toLocaleDateString()}</span>
                              <span className={cx('font-medium', s.status === 'overdue' ? 'text-rose-400' : daysColor(s.due_date))}>
                                <Clock className="h-3 w-3 inline mr-1" />{daysLabel(s.due_date)}
                              </span>
                              {s.amount != null && <span className="flex items-center gap-0.5"><IndianRupee className="h-3 w-3" />{s.amount.toLocaleString('en-IN')}</span>}
                            </div>
                            {s.reference_number && <div className="text-xs text-slate-500 mt-1">Ref: {s.reference_number}</div>}
                            {s.notes && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{s.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {(s.status === 'pending' || s.status === 'overdue') && (
                              <button onClick={() => handleUpdateSubmission(s.id, { status: 'in_progress' } as any)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-medium transition-colors">
                                <Eye className="h-3.5 w-3.5" /> Start
                              </button>
                            )}
                            {s.status === 'in_progress' && (
                              <button onClick={() => handleUpdateSubmission(s.id, { status: 'submitted' } as any)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium transition-colors">
                                <Send className="h-3.5 w-3.5" /> Submit
                              </button>
                            )}
                            {s.status === 'submitted' && (
                              <button onClick={() => handleUpdateSubmission(s.id, { status: 'accepted' } as any)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium transition-colors">
                                <Check className="h-3.5 w-3.5" /> Accept
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Deadlines list */}
          {filingSubTab === 'deadlines' && (
            <div className="space-y-4">
              {filingDeadlines.length === 0 ? (
                <div className="text-center py-16 text-slate-500">No filing deadlines configured.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500 uppercase">
                        <th className="pb-3 pr-4">Filing</th>
                        <th className="pb-3 pr-4">Form</th>
                        <th className="pb-3 pr-4">Authority</th>
                        <th className="pb-3 pr-4">Frequency</th>
                        <th className="pb-3 pr-4">Due Day</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4">Penalty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filingDeadlines.map(dl => (
                        <tr key={dl.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td className="py-3 pr-4">
                            <div className="font-medium text-white">{dl.title}</div>
                            <div className="text-xs text-slate-500">{dl.regulation}</div>
                          </td>
                          <td className="py-3 pr-4 text-slate-300">{dl.form_name || '—'}</td>
                          <td className="py-3 pr-4 text-slate-400">{dl.authority || '—'}</td>
                          <td className="py-3 pr-4 text-slate-400 capitalize">{dl.frequency}</td>
                          <td className="py-3 pr-4 text-slate-300">{dl.due_day_of_month || '—'}</td>
                          <td className="py-3 pr-4">
                            <span className={cx('text-xs px-2 py-0.5 rounded-full border', dl.is_active ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-600/20 text-slate-400 border-slate-600/30')}>
                              {dl.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-xs text-slate-500 max-w-[200px] truncate" title={dl.penalty_info}>{dl.penalty_info || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Alerts list */}
          {filingSubTab === 'alerts' && (
            <div className="space-y-4">
              {filingAlerts.length > 0 && (
                <div className="flex justify-end">
                  <button onClick={handleMarkAllAlertsRead}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 text-slate-300 hover:text-white border border-slate-700/50 text-xs font-medium transition-colors">
                    <BellOff className="h-3.5 w-3.5" /> Dismiss All
                  </button>
                </div>
              )}
              {filingAlerts.length === 0 ? (
                <div className="text-center py-16 text-slate-500">No unread alerts</div>
              ) : (
                <div className="space-y-3">
                  {filingAlerts.map(a => (
                    <div key={a.id} className={cx('bg-slate-800/30 border rounded-xl p-4 transition-colors',
                      a.severity === 'critical' ? 'border-rose-500/40 bg-rose-500/5' : a.severity === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/50')}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={cx('text-xs px-2 py-0.5 rounded-full border uppercase',
                              a.severity === 'critical' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : a.severity === 'warning' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-blue-500/15 text-blue-300 border-blue-500/30')}>
                              {a.alert_type.replace('_', ' ')}
                            </span>
                          </div>
                          <h3 className="text-sm font-semibold text-white">{a.title}</h3>
                          {a.message && <p className="text-xs text-slate-400 mt-1">{a.message}</p>}
                          <div className="text-xs text-slate-500 mt-2">{new Date(a.created_at).toLocaleString()}</div>
                        </div>
                        <button onClick={() => handleMarkAlertRead(a.id)}
                          className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-white transition-colors" title="Dismiss">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Deadline Drawer */}
      {showAddDeadline && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddDeadline(false)} />
          <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-700/50 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Add Deadline</h2>
              <button onClick={() => setShowAddDeadline(false)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Title *</label>
                <input value={newDeadline.title} onChange={e => setNewDeadline(p => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Regulation</label>
                <input value={newDeadline.regulation} onChange={e => setNewDeadline(p => ({ ...p, regulation: e.target.value }))} placeholder="e.g. GST, TDS, ROC"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Description</label>
                <textarea value={newDeadline.description} onChange={e => setNewDeadline(p => ({ ...p, description: e.target.value }))} rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50 resize-none" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Due Date *</label>
                <input type="date" value={newDeadline.due_date} onChange={e => setNewDeadline(p => ({ ...p, due_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Recurring</label>
                <select value={newDeadline.recurring} onChange={e => setNewDeadline(p => ({ ...p, recurring: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50">
                  <option value="">None</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <button onClick={handleCreateDeadline} disabled={busy || !newDeadline.title || !newDeadline.due_date}
                className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Deadline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Evidence Drawer */}
      {showAddEvidence && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddEvidence(false)} />
          <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-700/50 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Add Evidence</h2>
              <button onClick={() => setShowAddEvidence(false)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Title *</label>
                <input value={newEvidence.title} onChange={e => setNewEvidence(p => ({ ...p, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Control Area</label>
                <input value={newEvidence.control_area} onChange={e => setNewEvidence(p => ({ ...p, control_area: e.target.value }))} placeholder="e.g. Data Protection, Access Control"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Source</label>
                <input value={newEvidence.source} onChange={e => setNewEvidence(p => ({ ...p, source: e.target.value }))} placeholder="e.g. HR System, Finance Tool"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Linked Deadline</label>
                <select value={newEvidence.deadline_id} onChange={e => setNewEvidence(p => ({ ...p, deadline_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50">
                  <option value="">None</option>
                  {deadlines.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </div>
              <button onClick={handleCreateEvidence} disabled={busy || !newEvidence.title}
                className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Evidence
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
