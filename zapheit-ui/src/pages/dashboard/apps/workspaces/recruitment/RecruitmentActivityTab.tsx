import { useState, useCallback, useEffect } from 'react';
import { Activity, Loader2, CheckCircle, Clock, XCircle, AlertTriangle } from 'lucide-react';
import { api } from '../../../../../lib/api-client';

interface AuditEntry {
  id: string;
  action: string;
  connector: string;
  status: 'approved' | 'pending' | 'blocked' | 'completed';
  created_at: string;
  actor?: string;
}

const RECRUITMENT_ACTIONS = new Set([
  'search_candidates', 'get_candidate', 'get_profile', 'send_inmail',
  'create_job', 'list_job_postings', 'parse_resume',
]);

const STATUS_ICON: Record<AuditEntry['status'], React.ElementType> = {
  approved:  CheckCircle,
  completed: CheckCircle,
  pending:   Clock,
  blocked:   XCircle,
};
const STATUS_COLOR: Record<AuditEntry['status'], string> = {
  approved:  'text-emerald-400',
  completed: 'text-emerald-400',
  pending:   'text-amber-400',
  blocked:   'text-rose-400',
};

const ACTION_LABELS: Record<string, string> = {
  search_candidates: 'Searched candidates',
  get_candidate:     'Fetched candidate profile',
  get_profile:       'Fetched LinkedIn profile',
  send_inmail:       'Sent InMail',
  create_job:        'Created job posting',
  list_job_postings: 'Listed job postings',
  parse_resume:      'Parsed resume',
};

const CONNECTOR_LABELS: Record<string, string> = {
  'linkedin-recruiter': 'LinkedIn',
  naukri:               'Naukri',
};

export default function RecruitmentActivityTab() {
  const [entries, setEntries]   = useState<AuditEntry[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await (api as any).auditLogs?.list?.({ limit: 50 });
      const raw: any[] = Array.isArray(res?.data) ? res.data : [];
      const filtered = raw
        .filter((r) => RECRUITMENT_ACTIONS.has(r.action) || ['linkedin-recruiter', 'naukri'].includes(r.connector_id))
        .map((r): AuditEntry => ({
          id:         r.id || String(Math.random()),
          action:     r.action,
          connector:  r.connector_id || r.connector,
          status:     r.status || 'completed',
          created_at: r.created_at || r.timestamp,
          actor:      r.actor_name || r.user_email,
        }));
      setEntries(filtered);
    } catch {
      // API may not expose audit logs yet — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
        <span className="text-xs text-slate-500">{entries.length} recruitment actions logged</span>
        <button onClick={() => void load()} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-3 text-slate-500 mt-16">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading activity…</span>
          </div>
        ) : entries.length > 0 ? (
          <div className="space-y-2">
            {entries.map((e) => {
              const Icon = STATUS_ICON[e.status];
              return (
                <div key={e.id} className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/[0.02]">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${STATUS_COLOR[e.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{ACTION_LABELS[e.action] || e.action}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                      <span>{CONNECTOR_LABELS[e.connector] || e.connector}</span>
                      {e.actor && <><span>·</span><span>{e.actor}</span></>}
                      {e.created_at && (
                        <><span>·</span><span>{new Date(e.created_at).toLocaleString()}</span></>
                      )}
                    </div>
                  </div>
                  {e.status === 'pending' && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      <AlertTriangle className="w-2.5 h-2.5" /> Awaiting approval
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center mt-16">
            <Activity className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No recruitment actions yet</p>
            <p className="text-xs text-slate-600 mt-1">Search candidates, send InMails, or post jobs to see activity here</p>
          </div>
        )}
      </div>
    </div>
  );
}
