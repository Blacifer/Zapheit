import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, RefreshCw, Shield, Sparkles, X } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { AccessRequestHub } from '../../../../types';
import type { UnifiedApp } from '../types';

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

function policyBadge(result: string | null | undefined) {
  if (!result) return '';
  const m: Record<string, string> = {
    auto_approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    needs_review: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    denied: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  };
  return m[result] || 'bg-slate-600/20 text-slate-300 border-slate-600/30';
}

function relativeTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

interface ItWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function ItWorkspaceTab({ app, agentNames }: ItWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<AccessRequestHub[]>([]);
  const [workspacePreview, setWorkspacePreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [requestRes, previewRes] = await Promise.all([
        api.hubs.it.listRequests({ limit: 80 }),
        app.connected && app.primaryServiceId && ['okta', 'jumpcloud', 'jamf', 'azure-ad', 'azure_ad', 'onelogin', 'kandji'].includes(String(app.primaryServiceId).toLowerCase())
          ? api.integrations.getWorkspacePreview(app.primaryServiceId)
          : Promise.resolve(null),
      ]);
      if (requestRes.success && requestRes.data) setRequests(requestRes.data);
      else toast.error(requestRes.error || 'Failed to load access requests');
      if (previewRes?.success && previewRes.data) setWorkspacePreview(previewRes.data);
      else setWorkspacePreview(null);
    } finally {
      setBusy(false);
    }
  }, [app.connected, app.primaryServiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(() => requests.filter((request) => request.status === 'pending').length, [requests]);
  const evaluatedCount = useMemo(() => requests.filter((request) => request.ai_evaluated_at).length, [requests]);
  const riskyCount = useMemo(() => requests.filter((request) => (request.ai_risk_rating ?? 0) > 60).length, [requests]);

  const handleEvaluate = async (id: string) => {
    const res = await api.hubs.it.evaluateRequest(id);
    if (res.success) {
      toast.success('Request evaluated');
      await load();
    } else {
      toast.error(res.error || 'Evaluation failed');
    }
  };

  const handleUpdate = async (id: string, status: string) => {
    const res = await api.hubs.it.updateRequest(id, { status });
    if (res.success) {
      toast.success(`Request ${status}`);
      await load();
    } else {
      toast.error(res.error || 'Update failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300">IT workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} access operations inside Rasi</h3>
            <p className="mt-1 text-sm text-slate-400">Keep access requests, policy evaluation, and risky approvals in one controlled workspace before agents or humans change permissions.</p>
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
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending</p>
            <p className="mt-2 text-2xl font-semibold text-white">{pendingCount}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Evaluated</p>
            <p className="mt-2 text-2xl font-semibold text-white">{evaluatedCount}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">High risk</p>
            <p className="mt-2 text-2xl font-semibold text-white">{riskyCount}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
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
            <h4 className="text-sm font-semibold text-white">Access queue</h4>
          </div>
          <div className="divide-y divide-white/6">
            {requests.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No access requests available.</div>
            ) : requests.slice(0, 10).map((request) => (
              <div key={request.id} className="px-4 py-4">
                <div className="flex items-start gap-4">
                  <div className={cx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border', riskBg(request.ai_risk_rating))}>
                    <span className={cx('text-sm font-bold', riskColor(request.ai_risk_rating))}>{request.ai_risk_rating ?? '—'}</span>
                    <span className="text-[8px] text-slate-500">risk</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">{request.subject}</p>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusBadge(request.status))}>{request.status}</span>
                      {request.ai_policy_result ? <span className={cx('rounded-full border px-2 py-0.5 text-[10px]', policyBadge(request.ai_policy_result))}>{request.ai_policy_result.replace('_', ' ')}</span> : null}
                    </div>
                    {request.requestor_email ? <p className="mt-1 text-xs text-slate-500">{request.requestor_email}</p> : null}
                    {request.ai_evaluation_notes ? <p className="mt-1 text-xs text-slate-400">{request.ai_evaluation_notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!request.ai_evaluated_at ? (
                      <button onClick={() => void handleEvaluate(request.id)} className="rounded-lg p-2 text-purple-300 hover:bg-purple-500/10" title="Evaluate">
                        <Sparkles className="h-4 w-4" />
                      </button>
                    ) : null}
                    {request.status === 'pending' ? (
                      <>
                        <button onClick={() => void handleUpdate(request.id, 'approved')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Approve">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => void handleUpdate(request.id, 'rejected')} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" title="Reject">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {workspacePreview ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-4 py-3">
                <h4 className="text-sm font-semibold text-white">Connected identity feed</h4>
              </div>
              <div className="space-y-3 px-4 py-4">
                {workspacePreview.metrics ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(workspacePreview.metrics).slice(0, 4).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-white/8 bg-[#121826] p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{key.replace(/_/g, ' ')}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.records) && workspacePreview.records.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider users</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.records.slice(0, 5).map((record: any) => (
                        <div key={record.id} className="px-3 py-3">
                          <p className="text-sm font-medium text-white">{record.label}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>{record.status}</span>
                            {record.meta ? <span>• {record.meta}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.groups) && workspacePreview.groups.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider groups</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.groups.slice(0, 5).map((group: any) => (
                        <div key={group.id} className="px-3 py-3">
                          <p className="text-sm font-medium text-white">{group.name}</p>
                          {group.description ? <p className="mt-1 text-xs text-slate-400">{group.description}</p> : null}
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

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Policy log</h4>
            </div>
            <div className="divide-y divide-white/6">
              {requests.filter((request) => request.ai_evaluated_at).length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No evaluated requests yet.</div>
              ) : requests.filter((request) => request.ai_evaluated_at).slice(0, 8).map((request) => (
                <div key={request.id} className="px-4 py-4">
                  <p className="font-medium text-white">{request.subject}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {request.ai_policy_result ? <span className={cx('rounded-full border px-2 py-0.5', policyBadge(request.ai_policy_result))}>{request.ai_policy_result.replace('_', ' ')}</span> : null}
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{relativeTime(request.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-300" />
              <h4 className="text-sm font-semibold text-white">Control note</h4>
            </div>
            <p className="mt-3 text-sm text-slate-400">This workspace is where access decisions should happen before runtime actions touch Okta, Azure AD, or device-management rails.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
