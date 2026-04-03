import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, FileSearch, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { HubDeadline, HubEvidence } from '../../../../types';
import type { UnifiedApp } from '../types';

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
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
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

interface ComplianceWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function ComplianceWorkspaceTab({ app, agentNames }: ComplianceWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [deadlines, setDeadlines] = useState<HubDeadline[]>([]);
  const [evidence, setEvidence] = useState<HubEvidence[]>([]);
  const [posture, setPosture] = useState<{ score: number; total: number; completed: number; overdue: number; upcoming: number } | null>(null);
  const [workspacePreview, setWorkspacePreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [dRes, eRes, pRes, previewRes] = await Promise.all([
        api.hubs.compliance.listDeadlines(),
        api.hubs.compliance.listEvidence(),
        api.hubs.compliance.getPosture(),
        app.connected && app.primaryServiceId && ['cleartax'].includes(String(app.primaryServiceId).toLowerCase())
          ? api.integrations.getWorkspacePreview(app.primaryServiceId)
          : Promise.resolve(null),
      ]);
      if (dRes.data) setDeadlines(dRes.data);
      if (eRes.data) setEvidence(eRes.data);
      if (pRes.data) setPosture(pRes.data);
      if (previewRes?.success && previewRes.data) setWorkspacePreview(previewRes.data);
      else setWorkspacePreview(null);
    } catch {
      toast.error('Failed to load compliance workspace');
    } finally {
      setBusy(false);
    }
  }, [app.connected, app.primaryServiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdueCount = useMemo(() => deadlines.filter((deadline) => daysUntil(deadline.due_date) < 0).length, [deadlines]);

  const handleChecklist = async (id: string) => {
    const res = await api.hubs.compliance.generateChecklist(id);
    if (res.data) {
      setDeadlines((prev) => prev.map((deadline) => deadline.id === id ? res.data! : deadline));
      toast.success('Checklist generated');
    } else {
      toast.error(res.error || 'Checklist generation failed');
    }
  };

  const handleDeadlineStatus = async (id: string, status: string) => {
    const res = await api.hubs.compliance.updateDeadline(id, { status });
    if (res.data) {
      setDeadlines((prev) => prev.map((deadline) => deadline.id === id ? res.data! : deadline));
      toast.success('Deadline updated');
    } else {
      toast.error(res.error || 'Update failed');
    }
  };

  const handleEvidenceStatus = async (id: string, status: string) => {
    const res = await api.hubs.compliance.updateEvidence(id, { status });
    if (res.data) {
      setEvidence((prev) => prev.map((item) => item.id === id ? res.data! : item));
      toast.success('Evidence updated');
    } else {
      toast.error(res.error || 'Update failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Compliance workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} compliance operations inside Rasi</h3>
            <p className="mt-1 text-sm text-slate-400">Track deadlines, posture, and evidence in one governed workspace before filing or remediation actions move forward.</p>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Posture score</p>
            <p className="mt-2 text-2xl font-semibold text-white">{posture?.score ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Deadlines</p>
            <p className="mt-2 text-2xl font-semibold text-white">{deadlines.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Overdue</p>
            <p className="mt-2 text-2xl font-semibold text-white">{overdueCount}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Evidence items</p>
            <p className="mt-2 text-2xl font-semibold text-white">{evidence.length}</p>
          </div>
        </div>
        {agentNames.length > 0 && <p className="mt-3 text-xs text-slate-500">Linked agents: <span className="text-slate-300">{agentNames.join(', ')}</span></p>}
        {workspacePreview?.suggested_next_action ? (
          <p className="mt-2 text-xs text-cyan-300">Next: {workspacePreview.suggested_next_action}</p>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Deadline calendar</h4>
          </div>
          <div className="divide-y divide-white/6">
            {deadlines.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No compliance deadlines available.</div>
            ) : deadlines.slice(0, 10).map((deadline) => (
              <div key={deadline.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{deadline.title}</p>
                      {deadline.regulation ? <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-300">{deadline.regulation}</span> : null}
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px]', statusBadge(deadline.status))}>{deadline.status.replace('_', ' ')}</span>
                    </div>
                    {deadline.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-400">{deadline.description}</p> : null}
                    <p className={cx('mt-2 text-xs font-medium', daysColor(deadline.due_date))}>
                      <CalendarDays className="mr-1 inline h-3 w-3" />
                      {daysLabel(deadline.due_date)}
                    </p>
                    {deadline.ai_checklist?.length ? (
                      <p className="mt-1 text-xs text-slate-500">{deadline.ai_checklist.filter((item) => item.done).length}/{deadline.ai_checklist.length} checklist items completed</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => void handleChecklist(deadline.id)} className="rounded-lg p-2 text-purple-300 hover:bg-purple-500/10" title="Checklist">
                      <Sparkles className="h-4 w-4" />
                    </button>
                    {deadline.status !== 'completed' && (
                      <button onClick={() => void handleDeadlineStatus(deadline.id, 'completed')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Complete">
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {workspacePreview ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-sky-300" />
                <h4 className="text-sm font-semibold text-white">Connected compliance feed</h4>
              </div>
              <div className="mt-4 space-y-3">
                {workspacePreview.profile ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Connection profile</p>
                    <p className="mt-2 text-sm font-medium text-white">{workspacePreview.profile.legal_name || workspacePreview.profile.gstin || 'Connected compliance account'}</p>
                    {workspacePreview.profile.filing_status ? <p className="text-xs text-slate-400">Filing status: {workspacePreview.profile.filing_status}</p> : null}
                  </div>
                ) : null}

                {workspacePreview.metrics ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(workspacePreview.metrics).slice(0, 4).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-white/8 bg-[#121826] p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{key.replace(/_/g, ' ')}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{String(value ?? '—')}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.records) && workspacePreview.records.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider notices</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.records.slice(0, 5).map((record: any) => (
                        <div key={record.id} className="px-3 py-3">
                          <p className="text-sm font-medium text-white">{record.label}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className={cx('rounded-full border px-2 py-0.5', statusBadge(record.status || 'upcoming'))}>{String(record.status || 'open').replace('_', ' ')}</span>
                            {record.updated_at ? <span>{new Date(record.updated_at).toLocaleDateString()}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.notes) && workspacePreview.notes.length > 0 ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {workspacePreview.notes.join(' ')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              <h4 className="text-sm font-semibold text-white">Posture summary</h4>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Completed</p>
                <p className="mt-2 text-xl font-semibold text-white">{posture?.completed ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Upcoming</p>
                <p className="mt-2 text-xl font-semibold text-white">{posture?.upcoming ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Overdue</p>
                <p className="mt-2 text-xl font-semibold text-white">{posture?.overdue ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Total controls</p>
                <p className="mt-2 text-xl font-semibold text-white">{posture?.total ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Evidence queue</h4>
            </div>
            <div className="divide-y divide-white/6">
              {evidence.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No evidence items available.</div>
              ) : evidence.slice(0, 8).map((item) => (
                <div key={item.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4 text-cyan-300" />
                        <p className="font-medium text-white">{item.title}</p>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{item.control_area || 'General evidence'} {item.source ? `• ${item.source}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px]', statusBadge(item.status))}>{item.status}</span>
                      {item.status !== 'accepted' && (
                        <button onClick={() => void handleEvidenceStatus(item.id, 'accepted')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Accept">
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
