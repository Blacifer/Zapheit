import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield, Sparkles, FileCheck, Settings2, RefreshCw, Plus, X, Check, Loader2, Clock,
} from 'lucide-react';
import { GitBranch, SquareKanban } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { HubLiveMetrics } from './hubs/HubLiveMetrics';
import type { IntegrationConfig } from './hubs/HubLiveMetrics';
import type { AccessRequestHub } from '../../types';

type TabId = 'queue' | 'log' | 'settings';

const IT_INTEGRATIONS: IntegrationConfig[] = [
  {
    connectorId: 'jira',
    appName: 'Jira',
    icon: <SquareKanban className="w-3.5 h-3.5 text-blue-400" />,
    workspacePath: '/dashboard/apps/jira/workspace',
    brandBg: 'bg-blue-500/20',
    metrics: [
      { label: 'Open Issues', action: 'list_issues', params: { jql: 'status != Done', limit: 1 }, transform: d => Array.isArray(d) ? d.length : (d?.total ?? '—') },
      { label: 'In Progress', action: 'list_issues', params: { jql: 'status = "In Progress"', limit: 1 }, transform: d => Array.isArray(d) ? d.length : (d?.total ?? '—') },
    ],
  },
  {
    connectorId: 'github',
    appName: 'GitHub',
    icon: <GitBranch className="w-3.5 h-3.5 text-slate-300" />,
    workspacePath: '/dashboard/apps/github/workspace',
    brandBg: 'bg-slate-700/60',
    metrics: [
      { label: 'Open PRs', action: 'list_pulls', params: { state: 'open', limit: 50 }, transform: d => Array.isArray(d) ? d.length : 0 },
      { label: 'Open Issues', action: 'list_issues', params: { state: 'open', limit: 50 }, transform: d => Array.isArray(d) ? d.length : 0 },
    ],
  },
];

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function riskColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s <= 30) return 'text-emerald-400';
  if (s <= 60) return 'text-amber-400';
  return 'text-rose-400';
}

function riskBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50';
  if (s <= 30) return 'bg-emerald-500/15 border-emerald-500/30';
  if (s <= 60) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}

function policyBadge(result: string | null | undefined) {
  if (!result) return '';
  const m: Record<string, string> = {
    auto_approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    needs_review: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    denied: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[result] || 'bg-slate-600/20 text-slate-300 border-slate-600/30';
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    completed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    canceled: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  };
  return m[s] || m.pending;
}

function sensitivityBadge(level: string | null | undefined) {
  const m: Record<string, string> = {
    standard: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    sensitive: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    critical: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[level || 'standard'] || m.standard;
}

function relativeTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export default function ITHubPage() {
  const [tab, setTab] = useState<TabId>('queue');
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<AccessRequestHub[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [sensitivityFilter, setSensitivityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.it.listRequests({ status: statusFilter || undefined, limit: 200 });
      if (res.success && res.data) setRequests(res.data);
      else toast.error(res.error || 'Failed to load');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [statusFilter]);

  const filtered = useMemo(() => {
    let r = requests;
    if (sensitivityFilter) r = r.filter(x => x.sensitivity_level === sensitivityFilter);
    return r;
  }, [requests, sensitivityFilter]);

  const evaluated = useMemo(() => requests.filter(r => r.ai_evaluated_at), [requests]);

  const handleEvaluate = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.it.evaluateRequest(id);
      if (res.success) { toast.success('Request evaluated'); void load(); }
      else toast.error(res.error || 'Evaluation failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleEvaluateAll = async () => {
    setBusy(true);
    try {
      const res = await api.hubs.it.evaluateAll();
      if (res.success) { toast.success(`Evaluated ${(res.data as any)?.evaluated || 0} requests`); void load(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      const res = await api.hubs.it.updateRequest(id, { status });
      if (res.success) { toast.success(`Request ${status}`); void load(); }
      else toast.error(res.error || 'Update failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
  };

  const tabs = [
    { id: 'queue' as const, label: 'Access Queue', icon: Shield },
    { id: 'log' as const, label: 'Policy Log', icon: FileCheck },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">IT Workspace</h1>
          <p className="text-sm text-slate-400 mt-1">Policy-driven access requests with AI risk evaluation and auto-approval.</p>
        </div>
        <button onClick={() => void load()} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60">
          <RefreshCw className={cx('w-4 h-4', busy && 'animate-spin')} /> Refresh
        </button>
      </div>

      <HubLiveMetrics configs={IT_INTEGRATIONS} />

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

      {/* ═══ QUEUE ═══ */}
      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All statuses</option>
              {['pending', 'approved', 'rejected', 'completed', 'canceled'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={sensitivityFilter} onChange={e => setSensitivityFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All sensitivity</option>
              {['standard', 'sensitive', 'critical'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={handleEvaluateAll} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> Evaluate All
            </button>
            <button onClick={() => setShowCreate(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Request
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Shield className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No access requests found.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
              {filtered.map(req => (
                <div key={req.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={cx('w-14 h-14 rounded-full border flex flex-col items-center justify-center shrink-0', riskBg(req.ai_risk_rating))}>
                      {req.ai_risk_rating != null ? (
                        <><span className={cx('text-lg font-bold', riskColor(req.ai_risk_rating))}>{req.ai_risk_rating}</span><span className="text-[8px] text-slate-500 -mt-0.5">risk</span></>
                      ) : (<span className="text-xs text-slate-500">N/A</span>)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold">{req.subject}</span>
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(req.status))}>{req.status}</span>
                        {req.system_name && <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/30">{req.system_name}</span>}
                        {req.department && <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700/50 text-slate-400 border border-slate-600">{req.department}</span>}
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', sensitivityBadge(req.sensitivity_level))}>{req.sensitivity_level || 'standard'}</span>
                        {req.ai_policy_result && <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold border', policyBadge(req.ai_policy_result))}>{req.ai_policy_result.replace('_', ' ')}</span>}
                      </div>
                      {req.requestor_email && <p className="text-xs text-slate-500 mt-1">{req.requestor_email}</p>}
                      {req.justification && <p className="text-sm text-slate-400 mt-1 line-clamp-2">{req.justification}</p>}
                      {req.ai_evaluation_notes && (
                        <div className="mt-2 bg-slate-800/50 border border-slate-700/50 rounded-lg p-2">
                          <p className="text-xs text-slate-300">{req.ai_evaluation_notes}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!req.ai_evaluated_at && <button onClick={() => handleEvaluate(req.id)} disabled={busy} className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 disabled:opacity-40" title="Evaluate"><Sparkles className="w-4 h-4" /></button>}
                      {req.status === 'pending' && <button onClick={() => handleUpdateStatus(req.id, 'approved')} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title="Approve"><Check className="w-4 h-4" /></button>}
                      {req.status === 'pending' && <button onClick={() => handleUpdateStatus(req.id, 'rejected')} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" title="Reject"><X className="w-4 h-4" /></button>}
                      <span className="text-[10px] text-slate-500 ml-1"><Clock className="w-3 h-3 inline" /> {relativeTime(req.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ POLICY LOG ═══ */}
      {tab === 'log' && (
        <div className="space-y-4">
          {evaluated.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <FileCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No evaluated requests yet.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-700 text-slate-400 text-xs">
                  <th className="px-4 py-3 text-left">Subject</th><th className="px-4 py-3 text-left">System</th><th className="px-4 py-3 text-left">Requestor</th><th className="px-4 py-3 text-center">Risk</th><th className="px-4 py-3 text-left">Policy Result</th><th className="px-4 py-3 text-left">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-800/60">
                  {evaluated.map(r => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 text-white">{r.subject}</td>
                      <td className="px-4 py-3 text-slate-400">{r.system_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{r.requestor_email || '—'}</td>
                      <td className="px-4 py-3 text-center"><span className={cx('font-bold', riskColor(r.ai_risk_rating))}>{r.ai_risk_rating ?? '—'}</span></td>
                      <td className="px-4 py-3">{r.ai_policy_result && <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold border', policyBadge(r.ai_policy_result))}>{r.ai_policy_result.replace('_', ' ')}</span>}</td>
                      <td className="px-4 py-3"><span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(r.status))}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ SETTINGS ═══ */}
      {tab === 'settings' && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 max-w-xl space-y-6">
          <h3 className="text-lg font-semibold text-white">Auto-Approval Settings</h3>
          <p className="text-sm text-slate-400">Requests with AI risk rating below the threshold are auto-approved by the policy engine.</p>
          <div>
            <label className="text-sm text-slate-300 block mb-2">Auto-approve threshold: <span className="font-semibold text-white">risk ≤ 30</span></label>
            <input type="range" min={0} max={100} value={30} readOnly className="w-full accent-purple-500" />
            <p className="text-xs text-slate-500 mt-1">Configured via backend policy. Contact your admin to change.</p>
          </div>
        </div>
      )}

      {showCreate && <CreateRequestDrawer onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}
    </div>
  );
}

function CreateRequestDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ subject: '', requestor_email: '', system_name: '', department: '', sensitivity_level: 'standard', justification: '' });

  const handleSubmit = async () => {
    if (!form.subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.it.createRequest({
        subject: form.subject.trim(), requestor_email: form.requestor_email.trim() || undefined,
        system_name: form.system_name.trim() || undefined, department: form.department.trim() || undefined,
        sensitivity_level: form.sensitivity_level as any, justification: form.justification.trim() || undefined,
      } as any);
      if (res.success) { toast.success('Request created'); onCreated(); }
      else toast.error(res.error || 'Failed');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">New Access Request</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="text-sm text-slate-300 block mb-1">Subject *</label><input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Access to production database" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Requestor Email</label><input type="email" value={form.requestor_email} onChange={e => setForm(f => ({ ...f, requestor_email: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
            <div><label className="text-sm text-slate-300 block mb-1">System</label><input value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} placeholder="e.g., AWS, GitHub" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Department</label><input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Engineering" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
            <div><label className="text-sm text-slate-300 block mb-1">Sensitivity</label><select value={form.sensitivity_level} onChange={e => setForm(f => ({ ...f, sensitivity_level: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="standard">Standard</option><option value="sensitive">Sensitive</option><option value="critical">Critical</option></select></div>
          </div>
          <div><label className="text-sm text-slate-300 block mb-1">Justification</label><textarea value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} rows={4} placeholder="Why do you need this access?" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y" /></div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Request
          </button>
        </div>
      </div>
    </div>
  );
}
