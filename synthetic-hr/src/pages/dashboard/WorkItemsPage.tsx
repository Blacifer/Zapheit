import { useCallback, useEffect, useMemo, useState } from 'react';
import { LifeBuoy, Target, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { SupportTicket, SalesLead, AccessRequest } from '../../types';

type TabId = 'support' | 'sales' | 'it';

const WORK_ITEMS_FOCUS_KEY = 'synthetic_hr.work_items_focus';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export default function WorkItemsPage() {
  const [tab, setTab] = useState<TabId>('support');
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [salesLeads, setSalesLeads] = useState<SalesLead[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);

  const tabs = useMemo(() => ([
    { id: 'support' as const, label: 'Support', icon: LifeBuoy },
    { id: 'sales' as const, label: 'Sales', icon: Target },
    { id: 'it' as const, label: 'IT', icon: KeyRound },
  ]), []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [t, l, a] = await Promise.all([
        api.workItems.supportTickets.list({ limit: 100 }),
        api.workItems.salesLeads.list({ limit: 100 }),
        api.workItems.accessRequests.list({ limit: 100 }),
      ]);
      if (t.success) setSupportTickets(t.data || []);
      if (l.success) setSalesLeads(l.data || []);
      if (a.success) setAccessRequests(a.data || []);

      const errors = [t, l, a].filter((r) => !r.success).map((r) => r.error).filter(Boolean) as string[];
      if (errors.length) {
        toast.error(errors[0]);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load work items');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const applyFocus = () => {
      try {
        const raw = localStorage.getItem(WORK_ITEMS_FOCUS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { tab?: TabId; id?: string };
        if (!parsed?.tab || !parsed?.id) return;
        setTab(parsed.tab);
        setHighlightId(parsed.id);
        localStorage.removeItem(WORK_ITEMS_FOCUS_KEY);
        window.setTimeout(() => setHighlightId(null), 6000);
      } catch {
        localStorage.removeItem(WORK_ITEMS_FOCUS_KEY);
      }
    };

    applyFocus();
    window.addEventListener('storage', applyFocus);
    return () => window.removeEventListener('storage', applyFocus);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Items</h1>
          <p className="text-sm text-slate-400 mt-1">Internal tickets, leads, and access requests created by humans or approved connector actions.</p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={classNames(
              'px-3 py-1.5 rounded-full text-xs border inline-flex items-center gap-2',
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'support' ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">
            Support Tickets ({supportTickets.length})
          </div>
          <div className="divide-y divide-slate-800/60">
            {supportTickets.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No tickets yet.</div>
            ) : supportTickets.map((t) => (
              <div
                key={t.id}
                className={classNames(
                  'p-4',
                  highlightId === t.id && 'ring-2 ring-cyan-400/60 bg-cyan-500/5'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{t.title}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Status: <span className="text-slate-200">{t.status}</span> · Priority:{' '}
                      <span className="text-slate-200">{t.priority}</span>
                      {t.customer_email ? <span className="text-slate-500"> · {t.customer_email}</span> : null}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{t.created_at}</div>
                </div>
                {t.description ? (
                  <div className="text-sm text-slate-300 mt-3 whitespace-pre-wrap">{t.description}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'sales' ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">
            Sales Leads ({salesLeads.length})
          </div>
          <div className="divide-y divide-slate-800/60">
            {salesLeads.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No leads yet.</div>
            ) : salesLeads.map((l) => (
              <div
                key={l.id}
                className={classNames(
                  'p-4',
                  highlightId === l.id && 'ring-2 ring-cyan-400/60 bg-cyan-500/5'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{l.company_name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Stage: <span className="text-slate-200">{l.stage}</span>
                      {typeof l.score === 'number' ? <span className="text-slate-500"> · Score {l.score}</span> : null}
                      {l.contact_email ? <span className="text-slate-500"> · {l.contact_email}</span> : null}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{l.created_at}</div>
                </div>
                {l.notes ? (
                  <pre className="text-xs text-slate-200 bg-slate-900/40 border border-slate-700 rounded-lg p-3 overflow-auto max-h-[200px] mt-3">
                    {JSON.stringify(l.notes, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'it' ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">
            Access Requests ({accessRequests.length})
          </div>
          <div className="divide-y divide-slate-800/60">
            {accessRequests.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No access requests yet.</div>
            ) : accessRequests.map((a) => (
              <div
                key={a.id}
                className={classNames(
                  'p-4',
                  highlightId === a.id && 'ring-2 ring-cyan-400/60 bg-cyan-500/5'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{a.subject}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Status: <span className="text-slate-200">{a.status}</span>
                      {a.system_name ? <span className="text-slate-500"> · {a.system_name}</span> : null}
                      {a.requestor_email ? <span className="text-slate-500"> · {a.requestor_email}</span> : null}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">{a.created_at}</div>
                </div>
                {a.requested_access ? (
                  <pre className="text-xs text-slate-200 bg-slate-900/40 border border-slate-700 rounded-lg p-3 overflow-auto max-h-[200px] mt-3">
                    {JSON.stringify(a.requested_access, null, 2)}
                  </pre>
                ) : null}
                {a.justification ? (
                  <div className="text-sm text-slate-300 mt-3 whitespace-pre-wrap">{a.justification}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
