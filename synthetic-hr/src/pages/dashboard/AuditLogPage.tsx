import { useState, useEffect, useCallback } from 'react';
import {
  Search, Download, RefreshCw, ChevronLeft, ChevronRight,
  Shield, Filter, X, ChevronDown, ChevronUp, Clock,
  User, Activity, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import type { AuditLogEntry } from '../../lib/api-client';
import { toast } from '../../lib/toast';

const PAGE_SIZE = 50;

const ACTION_CATEGORIES: Record<string, string[]> = {
  'Agent': ['agent.created', 'agent.updated', 'agent.deleted', 'agent.kill_switch'],
  'Incident': ['incident.resolved'],
  'Auth': ['auth.login', 'auth.logout', 'auth.failed_login'],
  'Compliance': ['compliance.export_requested', 'compliance.export_completed'],
  'Policy': ['policy.created', 'policy.updated', 'policy.deleted'],
};

const RESOURCE_TYPES = ['agent', 'incident', 'policy', 'compliance_export', 'api_key', 'webhook', 'integration'];

function formatAction(action: string): string {
  return action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' → ');
}

function formatTimestamp(ts: string): { date: string; time: string; relative: string } {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = '';
  if (diffMins < 1) relative = 'just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays < 7) relative = `${diffDays}d ago`;
  else relative = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    relative,
  };
}

function getUserLabel(entry: AuditLogEntry): string {
  if (entry.users?.full_name) return entry.users.full_name;
  if (entry.users?.email) return entry.users.email.split('@')[0];
  if (entry.user_id) return entry.user_id.slice(0, 8) + '…';
  return 'System';
}

function actionColor(action: string): string {
  if (action.includes('kill_switch') || action.includes('deleted') || action.includes('failed')) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  if (action.includes('created') || action.includes('login')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (action.includes('updated') || action.includes('resolved')) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  return 'border-slate-600 bg-slate-800/60 text-slate-300';
}

function exportToCSV(entries: AuditLogEntry[]) {
  const headers = ['Timestamp', 'User', 'Action', 'Resource Type', 'Resource ID', 'IP Address', 'Status', 'Details'];
  const rows = entries.map((e) => [
    new Date(e.created_at).toISOString(),
    getUserLabel(e),
    e.action,
    e.resource_type || '',
    e.resource_id || '',
    e.ip_address || '',
    e.status || 'success',
    JSON.stringify(e.details || {}),
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `rasi-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterResourceType, setFilterResourceType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await api.auditLogs.list({
        search: search || undefined,
        action: filterAction || undefined,
        resource_type: filterResourceType || undefined,
        from: filterFrom ? new Date(filterFrom).toISOString() : undefined,
        to: filterTo ? new Date(filterTo + 'T23:59:59').toISOString() : undefined,
        page: p,
        limit: PAGE_SIZE,
      });

      if (result.success && result.data) {
        setEntries(result.data);
        setTotal((result as any).total ?? result.data.length);
        setPage(p);
      } else {
        toast.error(result.error || 'Failed to load audit logs');
      }
    } finally {
      setLoading(false);
    }
  }, [search, filterAction, filterResourceType, filterFrom, filterTo]);

  useEffect(() => {
    load(1);
  }, [load]);

  const clearFilters = () => {
    setFilterAction('');
    setFilterResourceType('');
    setFilterFrom('');
    setFilterTo('');
    setSearch('');
  };

  const hasActiveFilters = !!(filterAction || filterResourceType || filterFrom || filterTo || search);

  const activeCount = [filterAction, filterResourceType, filterFrom, filterTo, search].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-950">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-800/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-100">Audit Log</h1>
              <p className="text-xs text-slate-500">
                {total > 0 ? `${total.toLocaleString()} events` : 'Full trail of all actions in your organization'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(page)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 border border-slate-700/60 hover:bg-slate-800/60 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => {
                if (entries.length === 0) { toast.error('No entries to export'); return; }
                exportToCSV(entries);
                toast.success(`Exported ${entries.length} entries as CSV`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search actions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700/60 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              showFilters || activeCount > 0
                ? 'text-violet-300 border-violet-500/40 bg-violet-500/10'
                : 'text-slate-400 border-slate-700/60 hover:bg-slate-800/60'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {activeCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/30 text-violet-200">
                {activeCount}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Expandable filter panel */}
        {showFilters && (
          <div className="mt-3 p-3 bg-slate-900/60 border border-slate-700/40 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Action</label>
              <select
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-xs text-slate-300 px-2.5 py-1.5 focus:outline-none focus:border-violet-500/50"
              >
                <option value="">All actions</option>
                {Object.entries(ACTION_CATEGORIES).map(([cat, actions]) => (
                  <optgroup key={cat} label={cat}>
                    {actions.map((a) => (
                      <option key={a} value={a}>{formatAction(a)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Resource Type</label>
              <select
                value={filterResourceType}
                onChange={(e) => setFilterResourceType(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-xs text-slate-300 px-2.5 py-1.5 focus:outline-none focus:border-violet-500/50"
              >
                <option value="">All types</option>
                {RESOURCE_TYPES.map((rt) => (
                  <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-xs text-slate-300 px-2.5 py-1.5 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">To</label>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-xs text-slate-300 px-2.5 py-1.5 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex-shrink-0 px-6 py-2.5 border-b border-slate-800/40 flex items-center gap-6 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          <span>{total.toLocaleString()} total events</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>Page {page} of {Math.max(totalPages, 1)}</span>
        </span>
        {hasActiveFilters && (
          <span className="flex items-center gap-1.5 text-violet-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Filtered</span>
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            Loading audit log…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <Shield className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">No audit events found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-xs text-violet-400 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
              <tr className="border-b border-slate-800/60">
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium w-36">Timestamp</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium w-32">User</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium">Action</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium w-28">Resource</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium w-28">IP Address</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-medium w-20">Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {entries.map((entry) => {
                const ts = formatTimestamp(entry.created_at);
                const isExpanded = expandedId === entry.id;
                return (
                  <>
                    <tr
                      key={entry.id}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="text-slate-400 font-mono">{ts.time}</div>
                        <div className="text-slate-600 mt-0.5">{ts.date}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                            <User className="w-3 h-3 text-slate-400" />
                          </div>
                          <span className="text-slate-300 truncate max-w-[100px]" title={getUserLabel(entry)}>
                            {getUserLabel(entry)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${actionColor(entry.action)}`}>
                          {formatAction(entry.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.resource_type ? (
                          <div>
                            <div className="text-slate-400">{entry.resource_type.replace(/_/g, ' ')}</div>
                            {entry.resource_id && (
                              <div className="text-slate-600 font-mono mt-0.5">{entry.resource_id.slice(0, 8)}…</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-500 font-mono">{entry.ip_address || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.status === 'failure' ? (
                          <span className="flex items-center gap-1 text-rose-400">
                            <AlertCircle className="w-3 h-3" />
                            Failed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </td>
                    </tr>

                    {/* Expanded details row */}
                    {isExpanded && (
                      <tr key={`${entry.id}-detail`} className="bg-slate-900/60">
                        <td colSpan={7} className="px-6 py-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1.5">Details</div>
                              <pre className="text-xs text-slate-400 font-mono bg-slate-950/60 rounded-lg p-3 overflow-auto max-h-40 border border-slate-800/60">
                                {JSON.stringify(entry.details || {}, null, 2)}
                              </pre>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Event ID</div>
                                <div className="font-mono text-slate-400 text-xs">{entry.id}</div>
                              </div>
                              {entry.resource_id && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Resource ID</div>
                                  <div className="font-mono text-slate-400 text-xs">{entry.resource_id}</div>
                                </div>
                              )}
                              {entry.user_agent && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">User Agent</div>
                                  <div className="text-slate-500 text-xs truncate">{entry.user_agent}</div>
                                </div>
                              )}
                              {entry.error_message && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-rose-600 mb-1">Error</div>
                                  <div className="text-rose-400 text-xs">{entry.error_message}</div>
                                </div>
                              )}
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Exact Timestamp</div>
                                <div className="font-mono text-slate-400 text-xs">{new Date(entry.created_at).toISOString()}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 px-6 py-3 border-t border-slate-800/60 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} events
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border border-slate-700/60 text-slate-400 hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              if (p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => load(p)}
                  disabled={loading}
                  className={`w-7 h-7 rounded-lg text-xs border transition-colors ${
                    p === page
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                      : 'border-slate-700/60 text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => load(page + 1)}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border border-slate-700/60 text-slate-400 hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
