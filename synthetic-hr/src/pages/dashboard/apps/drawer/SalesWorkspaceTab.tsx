import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, RefreshCw, Sparkles, TrendingDown, X } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { SalesLeadHub } from '../../../../types';
import type { UnifiedApp } from '../types';

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

const STAGES = ['new', 'qualified', 'discovery', 'demo', 'proposal', 'won', 'lost'] as const;

interface SalesWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function SalesWorkspaceTab({ app, agentNames }: SalesWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<SalesLeadHub[]>([]);
  const [workspacePreview, setWorkspacePreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [leadRes, previewRes] = await Promise.all([
        api.hubs.sales.listLeads({ limit: 80 }),
        app.connected && app.primaryServiceId && ['salesforce', 'hubspot'].includes(String(app.primaryServiceId).toLowerCase())
          ? api.integrations.getWorkspacePreview(app.primaryServiceId)
          : Promise.resolve(null),
      ]);
      if (leadRes.success && leadRes.data) setLeads(leadRes.data);
      else toast.error(leadRes.error || 'Failed to load sales pipeline');
      if (previewRes?.success && previewRes.data) setWorkspacePreview(previewRes.data);
      else setWorkspacePreview(null);
    } finally {
      setBusy(false);
    }
  }, [app.connected, app.primaryServiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byStage = useMemo(() => {
    const m: Record<string, SalesLeadHub[]> = {};
    STAGES.forEach((stage) => { m[stage] = []; });
    leads.forEach((lead) => { (m[lead.stage] || (m.new = m.new || [])).push(lead); });
    return m;
  }, [leads]);

  const coldDeals = useMemo(() => leads.filter((lead) => lead.stage !== 'won' && lead.stage !== 'lost' && (daysAgo(lead.last_activity_at || lead.created_at) >= 7 || (lead.ai_deal_score ?? 100) < 40)), [leads]);

  const handleScore = async (id: string) => {
    const res = await api.hubs.sales.scoreLead(id);
    if (res.success) {
      toast.success('Lead scored');
      await load();
    } else {
      toast.error(res.error || 'Scoring failed');
    }
  };

  const handleAdvance = async (lead: SalesLeadHub) => {
    const idx = STAGES.indexOf(lead.stage as any);
    if (idx < 0 || idx >= STAGES.length - 2) return;
    const next = STAGES[idx + 1];
    const res = await api.hubs.sales.updateLead(lead.id, { stage: next });
    if (res.success) {
      toast.success(`Moved to ${next}`);
      await load();
    } else {
      toast.error(res.error || 'Stage update failed');
    }
  };

  const handleLost = async (id: string) => {
    const res = await api.hubs.sales.updateLead(id, { stage: 'lost' });
    if (res.success) {
      toast.success('Marked as lost');
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
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Sales workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} pipeline operations inside Rasi</h3>
            <p className="mt-1 text-sm text-slate-400">Track lead quality, identify cold deals, and let agents work the pipeline without switching into external CRM tabs.</p>
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
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Open pipeline</p>
            <p className="mt-2 text-2xl font-semibold text-white">{leads.filter((lead) => !['won', 'lost'].includes(lead.stage)).length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">High confidence</p>
            <p className="mt-2 text-2xl font-semibold text-white">{leads.filter((lead) => (lead.ai_deal_score ?? 0) >= 70).length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Cold deals</p>
            <p className="mt-2 text-2xl font-semibold text-white">{coldDeals.length}</p>
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

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Pipeline board</h4>
          </div>
          <div className="grid gap-3 overflow-x-auto px-4 py-4 xl:grid-cols-3">
            {['new', 'qualified', 'discovery'].map((stage) => (
              <div key={stage} className="rounded-xl border border-white/8 bg-[#121826]">
                <div className="border-b border-white/8 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{stage}</p>
                </div>
                <div className="space-y-2 p-3">
                  {(byStage[stage] || []).slice(0, 4).map((lead) => (
                    <div key={lead.id} className="rounded-lg border border-white/8 bg-slate-900/40 p-3">
                      <div className="flex items-start gap-3">
                        <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', scoreBg(lead.ai_deal_score), scoreColor(lead.ai_deal_score))}>
                          {lead.ai_deal_score ?? '—'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{lead.company_name}</p>
                          {lead.contact_name ? <p className="truncate text-xs text-slate-400">{lead.contact_name}</p> : null}
                          {lead.ai_next_action ? <p className="mt-1 text-xs text-cyan-300">{lead.ai_next_action}</p> : null}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-emerald-300">{formatValue(lead.deal_value, lead.currency) || '—'}</span>
                        <div className="flex gap-1">
                          {!lead.ai_scored_at ? (
                            <button onClick={() => void handleScore(lead.id)} className="rounded-lg p-1.5 text-purple-300 hover:bg-purple-500/10" title="Score">
                              <Sparkles className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          <button onClick={() => void handleAdvance(lead)} className="rounded-lg p-1.5 text-cyan-300 hover:bg-cyan-500/10" title="Advance">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(byStage[stage] || []).length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No leads</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {workspacePreview ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-4 py-3">
                <h4 className="text-sm font-semibold text-white">Connected CRM feed</h4>
              </div>
              <div className="space-y-3 px-4 py-4">
                {workspacePreview.profile ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Connection profile</p>
                    <p className="mt-2 text-sm font-medium text-white">{workspacePreview.profile.name || workspacePreview.profile.email || 'Connected account'}</p>
                    {workspacePreview.profile.email ? <p className="text-xs text-slate-400">{workspacePreview.profile.email}</p> : null}
                  </div>
                ) : null}

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
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider leads</p>
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

                {Array.isArray(workspacePreview.deals) && workspacePreview.deals.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider deals</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.deals.slice(0, 4).map((deal: any) => (
                        <div key={deal.id} className="px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{deal.name}</p>
                            <span className="text-xs text-emerald-300">{formatValue(deal.amount, 'INR')}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{deal.stage}</p>
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
              <h4 className="text-sm font-semibold text-white">Cold deal watch</h4>
            </div>
            <div className="divide-y divide-white/6">
              {coldDeals.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No cold deals right now.</div>
              ) : coldDeals.slice(0, 8).map((lead) => (
                <div key={lead.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{lead.company_name}</p>
                      <p className="mt-1 text-xs text-slate-400">{daysAgo(lead.last_activity_at || lead.created_at)}d inactive</p>
                      {lead.ai_risk_reason ? <p className="mt-1 text-xs text-amber-300">{lead.ai_risk_reason}</p> : null}
                    </div>
                    <button onClick={() => void handleLost(lead.id)} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" title="Mark lost">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-amber-300" />
              <h4 className="text-sm font-semibold text-white">Agent guidance</h4>
            </div>
            <p className="mt-3 text-sm text-slate-400">Use linked agents to rescore leads, recommend next steps, and move low-risk deals forward while approvals still protect write actions.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
