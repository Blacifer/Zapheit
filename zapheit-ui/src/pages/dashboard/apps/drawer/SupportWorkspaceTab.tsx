import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Headset, MessageSquare, RefreshCw, Sparkles, X } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { SupportTicketHub } from '../../../../types';
import type { UnifiedApp } from '../types';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function urgencyColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 70) return 'text-rose-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-emerald-400';
}

function urgencyBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50 border-slate-700/40';
  if (s >= 70) return 'bg-rose-500/15 border-rose-500/30';
  if (s >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-emerald-500/15 border-emerald-500/30';
}

function statusBadge(s: string) {
  const m: Record<string, string> = {
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    resolved: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    closed: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  };
  return m[s] || m.open;
}

function priorityBadge(p: string) {
  const m: Record<string, string> = {
    urgent: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    high: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    medium: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    low: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  };
  return m[p] || m.low;
}

function slaRemaining(deadline: string | null | undefined) {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: 'Breached', color: 'text-rose-400' };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return { text: h < 1 ? `${m}m left` : `${h}h ${m}m left`, color: h < 4 ? 'text-amber-400' : 'text-slate-400' };
}

interface SupportWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function SupportWorkspaceTab({ app, agentNames }: SupportWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<SupportTicketHub[]>([]);
  const [workspacePreview, setWorkspacePreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [ticketsRes, previewRes] = await Promise.all([
        api.hubs.support.listTickets({ limit: 50 }),
        app.connected && app.primaryServiceId && ['zendesk', 'freshdesk', 'intercom'].includes(String(app.primaryServiceId).toLowerCase())
          ? api.integrations.getWorkspacePreview(app.primaryServiceId)
          : Promise.resolve(null),
      ]);

      if (ticketsRes.success && ticketsRes.data) setTickets(ticketsRes.data);
      else toast.error(ticketsRes.error || 'Failed to load support inbox');

      if (previewRes?.success && previewRes.data) setWorkspacePreview(previewRes.data);
      else setWorkspacePreview(null);
    } finally {
      setBusy(false);
    }
  }, [app.connected, app.primaryServiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const drafts = useMemo(() => tickets.filter((ticket) => ticket.ai_draft_response), [tickets]);
  const slaTickets = useMemo(() => tickets.filter((ticket) => ticket.sla_deadline), [tickets]);
  const highUrgency = useMemo(() => tickets.filter((ticket) => (ticket.ai_urgency_score ?? 0) >= 70).length, [tickets]);

  const handleTriage = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.support.triageTicket(id);
      if (res.success) {
        toast.success('Ticket triaged');
        await load();
      } else {
        toast.error(res.error || 'Triage failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (id: string, status: string) => {
    const res = await api.hubs.support.updateTicket(id, { status });
    if (res.success) {
      toast.success(`Ticket ${status}`);
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
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Support workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} customer operations inside Zapheit</h3>
            <p className="mt-1 text-sm text-slate-400">Run ticket triage, monitor urgency, and keep draft replies and SLA risk visible to operators and agents.</p>
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
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Open tickets</p>
            <p className="mt-2 text-2xl font-semibold text-white">{tickets.filter((t) => t.status === 'open').length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">AI drafts</p>
            <p className="mt-2 text-2xl font-semibold text-white">{drafts.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">SLA board</p>
            <p className="mt-2 text-2xl font-semibold text-white">{slaTickets.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">High urgency</p>
            <p className="mt-2 text-2xl font-semibold text-white">{highUrgency}</p>
          </div>
        </div>
        {agentNames.length > 0 && <p className="mt-3 text-xs text-slate-500">Linked agents: <span className="text-slate-300">{agentNames.join(', ')}</span></p>}
        {workspacePreview?.suggested_next_action ? (
          <p className="mt-2 text-xs text-cyan-300">Next: {workspacePreview.suggested_next_action}</p>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Ticket inbox</h4>
          </div>
          <div className="divide-y divide-white/6">
            {tickets.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No support tickets available.</div>
            ) : tickets.slice(0, 12).map((ticket) => (
              <div key={ticket.id} className="px-4 py-4">
                <div className="flex items-start gap-4">
                  <div className={cx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border', urgencyBg(ticket.ai_urgency_score))}>
                    <span className={cx('text-sm font-bold', urgencyColor(ticket.ai_urgency_score))}>{ticket.ai_urgency_score ?? '—'}</span>
                    <span className="text-[8px] text-slate-500">urgency</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-white">{ticket.title}</p>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusBadge(ticket.status))}>{ticket.status}</span>
                      <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', priorityBadge(ticket.priority))}>{ticket.priority}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-400">{ticket.description}</p>
                    {ticket.customer_email ? <p className="mt-1 text-xs text-slate-500">{ticket.customer_email}</p> : null}
                    {ticket.sla_deadline && (() => {
                      const sla = slaRemaining(ticket.sla_deadline);
                      return sla ? <p className={cx('mt-1 text-xs font-medium', sla.color)}>{sla.text}</p> : null;
                    })()}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!ticket.ai_triaged_at && (
                      <button onClick={() => void handleTriage(ticket.id)} className="rounded-lg p-2 text-purple-300 hover:bg-purple-500/10" title="Triage">
                        <Sparkles className="h-4 w-4" />
                      </button>
                    )}
                    {ticket.status === 'open' && (
                      <button onClick={() => void handleUpdate(ticket.id, 'resolved')} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10" title="Resolve">
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    {ticket.status !== 'closed' && (
                      <button onClick={() => void handleUpdate(ticket.id, 'closed')} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" title="Close">
                        <X className="h-4 w-4" />
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
            <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-4 py-3">
                <h4 className="text-sm font-semibold text-white">Connected app feed</h4>
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
                    <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider open</p>
                      <p className="mt-2 text-xl font-semibold text-white">{workspacePreview.metrics.open_count ?? 0}</p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Loaded</p>
                      <p className="mt-2 text-xl font-semibold text-white">{workspacePreview.metrics.total_loaded ?? 0}</p>
                    </div>
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.conversations) && workspacePreview.conversations.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider conversations</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.conversations.slice(0, 5).map((conversation: any) => (
                        <div key={conversation.id} className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Headset className="h-4 w-4 text-cyan-300" />
                            <p className="truncate text-sm font-medium text-white">{conversation.subject}</p>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className={cx('rounded-full border px-2 py-0.5 uppercase', statusBadge(conversation.status || 'open'))}>{conversation.status || 'open'}</span>
                            {conversation.updated_at ? <span>{new Date(conversation.updated_at).toLocaleString()}</span> : null}
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

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Draft replies</h4>
            </div>
            <div className="divide-y divide-white/6">
              {drafts.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No AI draft replies available yet.</div>
              ) : drafts.slice(0, 6).map((ticket) => (
                <div key={ticket.id} className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-cyan-300" />
                    <p className="font-medium text-white">{ticket.title}</p>
                  </div>
                  <p className="mt-2 line-clamp-4 text-sm text-slate-400">{ticket.ai_draft_response}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">SLA risk board</h4>
            </div>
            <div className="divide-y divide-white/6">
              {slaTickets.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No SLA deadlines are active.</div>
              ) : slaTickets.slice(0, 8).map((ticket) => {
                const sla = slaRemaining(ticket.sla_deadline);
                return (
                  <div key={ticket.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-300" />
                      <p className="truncate font-medium text-white">{ticket.title}</p>
                    </div>
                    {sla ? <p className={cx('mt-1 text-xs font-medium', sla.color)}>{sla.text}</p> : null}
                    {ticket.ai_urgency_score != null && ticket.ai_urgency_score >= 70 ? (
                      <p className="mt-1 text-xs text-rose-300">Escalation recommended due to high urgency.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
