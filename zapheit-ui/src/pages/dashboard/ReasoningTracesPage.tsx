import { useEffect, useState, useCallback } from 'react';
import { Activity, ChevronDown, ChevronRight, Filter, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Zap, DollarSign, Clock, Cpu } from 'lucide-react';
import { api } from '../../lib/api-client';
import type { AIAgent } from '../../types';
import { toast } from '../../lib/toast';

type Trace = {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  conversation_id: string | null;
  request_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  tool_calls: any[];
  tool_calls_count: number;
  risk_score: number | null;
  policy_violations: any[];
  interceptors_applied: any[];
  metadata: Record<string, any>;
  cost_usd: number;
  created_at: string;
};

type Stats = {
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_cost_usd: number;
  top_model: string | null;
};

type SortKey = 'created_at' | 'latency_ms' | 'cost_usd' | 'total_tokens' | 'risk_score';
type SortDir = 'asc' | 'desc';

function formatCost(usd: number): string {
  if (usd < 0.000001) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function ReasoningTracesPage({ agents }: { agents: AIAgent[] }) {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [agentFilter, setAgentFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [minLatency, setMinLatency] = useState('');

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const load = useCallback(async (reset = true) => {
    setLoading(true);
    try {
      const res = await api.agents.getTraces({
        agent_id: agentFilter || undefined,
        model: modelFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        min_latency: minLatency ? Number(minLatency) : undefined,
        limit: LIMIT,
        offset: reset ? 0 : offset,
        sort_by: sortKey === 'cost_usd' ? 'input_tokens' : sortKey, // cost is frontend-computed; sort by tokens as proxy
        sort_dir: sortDir,
      });
      if (!res.success) throw new Error(res.error || 'Failed to load traces');
      const d = res.data as any;
      const incoming: Trace[] = d?.traces || [];
      setTraces((prev) => reset ? incoming : [...prev, ...incoming]);
      setStats(d?.stats || null);
      if (reset) setOffset(0);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  }, [agentFilter, modelFilter, fromDate, toDate, minLatency, offset, sortKey, sortDir]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, modelFilter, fromDate, toDate, minLatency, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-slate-600" />;
    return sortDir === 'desc'
      ? <ArrowDown className="h-3 w-3 text-violet-400" />
      : <ArrowUp className="h-3 w-3 text-violet-400" />;
  }

  // Unique models from loaded traces for filter dropdown
  const modelOptions = Array.from(new Set(traces.map((t) => t.model).filter(Boolean))) as string[];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reasoning Traces</h1>
          <p className="mt-1 text-sm text-slate-400">Every LLM call through the gateway — tokens, latency, cost, tool calls, risk.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><Clock className="h-3.5 w-3.5" /> Avg latency</div>
            <p className="text-lg font-bold text-white">{formatMs(stats.avg_latency_ms)}</p>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><Activity className="h-3.5 w-3.5" /> P95 latency</div>
            <p className="text-lg font-bold text-white">{formatMs(stats.p95_latency_ms)}</p>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><DollarSign className="h-3.5 w-3.5" /> Total cost</div>
            <p className="text-lg font-bold text-white">{formatCost(stats.total_cost_usd)}</p>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><Cpu className="h-3.5 w-3.5" /> Top model</div>
            <p className="text-sm font-bold text-white truncate">{stats.top_model || '—'}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2 text-xs text-slate-400"><Filter className="h-3.5 w-3.5" /> Filters</div>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-white focus:outline-none"
        >
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-white focus:outline-none"
        >
          <option value="">All models</option>
          {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-white focus:outline-none"
          title="From date"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-white focus:outline-none"
          title="To date"
        />
        <input
          type="number"
          value={minLatency}
          onChange={(e) => setMinLatency(e.target.value)}
          placeholder="Min latency (ms)"
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none w-36"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60 text-left text-[10px] text-slate-400">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort('created_at')} className="flex items-center gap-1 hover:text-slate-200">
                    Timestamp <SortIcon col="created_at" />
                  </button>
                </th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort('total_tokens')} className="flex items-center gap-1 hover:text-slate-200">
                    Tokens <SortIcon col="total_tokens" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort('cost_usd')} className="flex items-center gap-1 hover:text-slate-200">
                    Cost <SortIcon col="cost_usd" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort('latency_ms')} className="flex items-center gap-1 hover:text-slate-200">
                    Latency <SortIcon col="latency_ms" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort('risk_score')} className="flex items-center gap-1 hover:text-slate-200">
                    Risk <SortIcon col="risk_score" />
                  </button>
                </th>
                <th className="px-4 py-3">Tools</th>
              </tr>
            </thead>
            <tbody>
              {loading && traces.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">Loading traces…</td>
                </tr>
              )}
              {!loading && traces.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">No traces found. Adjust filters or generate some LLM calls.</td>
                </tr>
              )}
              {traces.map((t) => {
                const isExpanded = expandedId === t.id;
                const riskColor = t.risk_score == null ? 'text-slate-500'
                  : t.risk_score > 0.7 ? 'text-rose-400'
                  : t.risk_score > 0.4 ? 'text-amber-400'
                  : 'text-emerald-400';
                return [
                  <tr
                    key={t.id}
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className="border-b border-slate-800 hover:bg-slate-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-slate-500">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-[120px] truncate">{t.agent_name || <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-slate-300 max-w-[140px] truncate">{t.model || '—'}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="text-slate-400">{t.input_tokens}</span>
                      <span className="text-slate-600 mx-1">+</span>
                      <span className="text-slate-400">{t.output_tokens}</span>
                      <span className="text-slate-600 ml-1 text-[10px]">= {t.total_tokens}</span>
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-mono">{formatCost(t.cost_usd)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatMs(t.latency_ms)}</td>
                    <td className={`px-4 py-3 font-mono ${riskColor}`}>
                      {t.risk_score != null ? t.risk_score.toFixed(3) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {t.tool_calls_count > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300"><Zap className="h-2.5 w-2.5" />{t.tool_calls_count}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${t.id}-expanded`} className="border-b border-slate-800 bg-slate-900/60">
                      <td colSpan={9} className="px-6 py-4">
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
                            <div>
                              <p className="text-slate-500 mb-1">Conversation ID</p>
                              <p className="font-mono text-slate-300 break-all">{t.conversation_id || '—'}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1">Request ID</p>
                              <p className="font-mono text-slate-300 break-all">{t.request_id || '—'}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1">Policy Violations</p>
                              <p className="text-slate-300">{Array.isArray(t.policy_violations) && t.policy_violations.length > 0 ? t.policy_violations.length : 'None'}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1">Interceptors Applied</p>
                              <p className="text-slate-300">{Array.isArray(t.interceptors_applied) && t.interceptors_applied.length > 0 ? t.interceptors_applied.length : 'None'}</p>
                            </div>
                          </div>
                          {Array.isArray(t.tool_calls) && t.tool_calls.length > 0 && (
                            <div>
                              <p className="text-slate-500 text-xs mb-2">Tool Calls</p>
                              <div className="space-y-2">
                                {t.tool_calls.map((tc: any, i: number) => (
                                  <div key={i} className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Zap className="h-3 w-3 text-violet-400" />
                                      <span className="text-xs font-semibold text-white">{tc.name || `Tool ${i + 1}`}</span>
                                      {tc.latency_ms != null && <span className="text-[10px] text-slate-500">{tc.latency_ms}ms</span>}
                                    </div>
                                    {tc.arguments && (
                                      <pre className="text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-all">
                                        {typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2)}
                                      </pre>
                                    )}
                                    {tc.result && (
                                      <pre className="mt-1 text-[10px] text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all">
                                        {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {t.metadata && Object.keys(t.metadata).length > 0 && (
                            <div>
                              <p className="text-slate-500 text-xs mb-2">Metadata</p>
                              <pre className="rounded-lg border border-slate-700 bg-slate-800/40 p-3 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(t.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
        {traces.length >= LIMIT && (
          <div className="border-t border-slate-700 p-4 text-center">
            <button
              onClick={() => { setOffset((o) => o + LIMIT); load(false); }}
              disabled={loading}
              className="rounded-xl border border-slate-700 bg-slate-800/40 px-6 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
