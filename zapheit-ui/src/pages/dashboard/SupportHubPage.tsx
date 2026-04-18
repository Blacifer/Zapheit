import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Headset, Sparkles, Clock, RefreshCw, Plus, X, Check, Loader2,
  MessageSquare, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { SupportTicketHub } from '../../types';

type TabId = 'inbox' | 'drafts' | 'sla';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function urgencyColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 70) return 'text-rose-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-emerald-400';
}

function urgencyBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50';
  if (s >= 70) return 'bg-rose-500/15 border-rose-500/30';
  if (s >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-emerald-500/15 border-emerald-500/30';
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

function statusBadge(s: string) {
  const m: Record<string, string> = {
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    resolved: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    closed: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  };
  return m[s] || m.open;
}

function slaRemaining(deadline: string | null | undefined): { text: string; color: string } {
  if (!deadline) return { text: '', color: '' };
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: 'BREACHED', color: 'text-rose-400 animate-pulse' };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h < 1) return { text: `${m}m left`, color: 'text-rose-400' };
  if (h < 4) return { text: `${h}h ${m}m left`, color: 'text-amber-400' };
  return { text: `${h}h ${m}m left`, color: 'text-slate-400' };
}

export default function SupportHubPage() {
  const [tab, setTab] = useState<TabId>('inbox');
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<SupportTicketHub[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.hubs.support.listTickets({ status: statusFilter || undefined, limit: 200 });
      if (res.success && res.data) setTickets(res.data);
      else toast.error(res.error || 'Failed to load tickets');
    } catch (e: any) { toast.error(e?.message || 'Failed to load tickets'); }
    finally { setBusy(false); }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [statusFilter]);

  const filtered = useMemo(() => {
    let t = tickets;
    if (priorityFilter) t = t.filter(x => x.priority === priorityFilter);
    return t;
  }, [tickets, priorityFilter]);

  const drafts = useMemo(() => tickets.filter(t => t.ai_draft_response), [tickets]);
  const slaTickets = useMemo(() =>
    [...tickets].filter(t => t.sla_deadline).sort((a, b) =>
      new Date(a.sla_deadline!).getTime() - new Date(b.sla_deadline!).getTime()
    ), [tickets]);

  const handleTriage = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.hubs.support.triageTicket(id);
      if (res.success) { toast.success('Ticket triaged'); void load(); }
      else toast.error(res.error || 'Triage failed');
    } catch (e: any) { toast.error(e?.message || 'Triage failed'); }
    finally { setBusy(false); }
  };

  const handleTriageAll = async () => {
    setBusy(true);
    try {
      const res = await api.hubs.support.triageAll();
      if (res.success) { toast.success(`Triaged ${(res.data as any)?.triaged || 0} tickets`); void load(); }
      else toast.error(res.error || 'Batch triage failed');
    } catch (e: any) { toast.error(e?.message || 'Batch triage failed'); }
    finally { setBusy(false); }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      const res = await api.hubs.support.updateTicket(id, { status });
      if (res.success) { toast.success(`Ticket ${status}`); void load(); }
      else toast.error(res.error || 'Update failed');
    } catch (e: any) { toast.error(e?.message || 'Update failed'); }
  };

  const tabs = [
    { id: 'inbox' as const, label: 'Inbox', icon: Headset },
    { id: 'drafts' as const, label: 'AI Drafts', icon: Sparkles },
    { id: 'sla' as const, label: 'SLA Board', icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Support Workspace</h1>
          <p className="text-sm text-slate-400 mt-1">AI-triaged ticket inbox with urgency scoring and draft responses.</p>
        </div>
        <button onClick={() => void load()} disabled={busy} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60">
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

      {/* ═══ INBOX ═══ */}
      {tab === 'inbox' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All statuses</option>
              {['open', 'pending', 'resolved', 'closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All priorities</option>
              {['urgent', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={handleTriageAll} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> Triage All
            </button>
            <button onClick={() => setShowCreate(true)} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Ticket
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Headset className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No tickets found.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-800/60">
              {filtered.map(ticket => (
                <div key={ticket.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={cx('w-14 h-14 rounded-full border flex flex-col items-center justify-center shrink-0', urgencyBg(ticket.ai_urgency_score))}>
                      {ticket.ai_urgency_score != null ? (
                        <><span className={cx('text-lg font-bold', urgencyColor(ticket.ai_urgency_score))}>{ticket.ai_urgency_score}</span><span className="text-[8px] text-slate-500 -mt-0.5">urgency</span></>
                      ) : (<span className="text-xs text-slate-500">N/A</span>)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold truncate">{ticket.title}</span>
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(ticket.status))}>{ticket.status}</span>
                        <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', priorityBadge(ticket.priority))}>{ticket.priority}</span>
                        {ticket.ai_category && <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30">{ticket.ai_category}</span>}
                        {ticket.channel && ticket.channel !== 'manual' && <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700/50 text-slate-400 border border-slate-600">{ticket.channel}</span>}
                      </div>
                      <p className="text-sm text-slate-400 mt-1 line-clamp-2">{ticket.description}</p>
                      {ticket.customer_email && <p className="text-xs text-slate-500 mt-1">{ticket.customer_email}</p>}
                      {ticket.sla_deadline && (() => { const sla = slaRemaining(ticket.sla_deadline); return sla.text ? <span className={cx('text-xs font-semibold mt-1 inline-block', sla.color)}>{sla.text}</span> : null; })()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!ticket.ai_triaged_at && <button onClick={() => handleTriage(ticket.id)} disabled={busy} className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 disabled:opacity-40" title="AI Triage"><Sparkles className="w-4 h-4" /></button>}
                      {ticket.status === 'open' && <button onClick={() => handleUpdateStatus(ticket.id, 'resolved')} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title="Resolve"><Check className="w-4 h-4" /></button>}
                      {ticket.status !== 'closed' && <button onClick={() => handleUpdateStatus(ticket.id, 'closed')} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" title="Close"><X className="w-4 h-4" /></button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ AI DRAFTS ═══ */}
      {tab === 'drafts' && (
        <div className="space-y-4">
          {drafts.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No AI-drafted responses yet. Triage tickets to generate drafts.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {drafts.map(ticket => (
                <div key={ticket.id} className="bg-slate-800/30 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold">{ticket.title}</span>
                    <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', priorityBadge(ticket.priority))}>{ticket.priority}</span>
                    {ticket.customer_email && <span className="text-xs text-slate-500">{ticket.customer_email}</span>}
                  </div>
                  <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs text-cyan-300 font-semibold">AI Draft Response</span>
                    </div>
                    <p className="text-sm text-slate-200">{ticket.ai_draft_response}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdateStatus(ticket.id, 'resolved')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> Send & Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SLA BOARD ═══ */}
      {tab === 'sla' && (
        <div className="space-y-4">
          {slaTickets.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No tickets with SLA deadlines.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-700 text-slate-400 text-xs">
                  <th className="px-4 py-3 text-left">Priority</th><th className="px-4 py-3 text-left">Title</th><th className="px-4 py-3 text-left">Customer</th><th className="px-4 py-3 text-left">SLA Remaining</th><th className="px-4 py-3 text-left">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-800/60">
                  {slaTickets.map(t => {
                    const sla = slaRemaining(t.sla_deadline);
                    const rowBg = sla.text === 'BREACHED' ? 'bg-rose-500/5' : sla.color.includes('amber') ? 'bg-amber-500/5' : '';
                    return (
                      <tr key={t.id} className={rowBg}>
                        <td className="px-4 py-3"><span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', priorityBadge(t.priority))}>{t.priority}</span></td>
                        <td className="px-4 py-3 text-white">{t.title}</td>
                        <td className="px-4 py-3 text-slate-400">{t.customer_email || '—'}</td>
                        <td className={cx('px-4 py-3 font-semibold', sla.color)}>{sla.text}</td>
                        <td className="px-4 py-3"><span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(t.status))}>{t.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ CREATE DRAWER ═══ */}
      {showCreate && <CreateTicketDrawer onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}
    </div>
  );
}

function CreateTicketDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', customer_email: '', channel: 'manual', tags: '' });

  const handleSubmit = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const res = await api.hubs.support.createTicket({
        title: form.title.trim(), description: form.description.trim() || undefined,
        priority: form.priority as any, customer_email: form.customer_email.trim() || undefined,
        channel: form.channel, tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      } as any);
      if (res.success) { toast.success('Ticket created'); onCreated(); }
      else toast.error(res.error || 'Failed to create ticket');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Create Support Ticket</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="text-sm text-slate-300 block mb-1">Title *</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ticket summary" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder="Details..." className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-sm text-slate-300 block mb-1">Priority</label><select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            <div><label className="text-sm text-slate-300 block mb-1">Channel</label><select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"><option value="manual">Manual</option><option value="email">Email</option><option value="slack">Slack</option><option value="zendesk">Zendesk</option><option value="freshdesk">Freshdesk</option></select></div>
          </div>
          <div><label className="text-sm text-slate-300 block mb-1">Customer Email</label><input type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))} placeholder="customer@example.com" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
          <div><label className="text-sm text-slate-300 block mb-1">Tags (comma-separated)</label><input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="billing, urgent" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" /></div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
