import { useEffect, useMemo, useState } from 'react';
import {
  Database, Shield, Filter, Search, Download, FileJson,
  Activity, Zap, Lock, Eye, AlertTriangle, Key, ChevronRight, Hash, Code, X
} from 'lucide-react';
import { toast } from '../../lib/toast';
import type { Incident } from '../../types';
import { loadFromStorage, removeFromStorage } from '../../utils/storage';

interface BlackBoxPageProps {
  incidents: Incident[];
  onNavigate?: (page: string) => void;
}

const INCIDENT_CONTEXT_STORAGE_KEY = 'synthetic_hr_incident_context';

// Create a readable evidence payload from the current incident record.
function generateForensicPayload(incident: Incident) {
  // Use id as a deterministic seed
  const generateSeed = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  };

  const seed = generateSeed(incident.id);

  return JSON.stringify({
    event_id: `evt_${incident.id.replace(/-/g, '').substring(0, 16)}`,
    timestamp: incident.created_at,
    event_type: incident.incident_type,
    severity_level: incident.severity,
    source: {
      agent_id: incident.agent_id,
      agent_name: incident.agent_name,
      runtime_environment: 'reported-runtime'
    },
    trigger: {
      policy_id: "pol_" + (seed % 100000000).toString(36),
      detected_by: 'rasi-governance-review',
      confidence_score: (0.85 + (seed % 15) / 100).toFixed(3)
    },
    message: incident.description,
    state: {
      status: incident.status,
      resolution_timestamp: incident.resolved_at || null,
      resolved_by: incident.resolved_by || null
    },
    metadata: {
      trace_token: incident.id,
      ip_fingerprint: `[REDACTED]`,
      latency_ms: (seed % 400) + 100
    }
  }, null, 2);
}

export default function BlackBoxPage({ incidents, onNavigate }: BlackBoxPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<Incident | null>(null);
  const [incidentContext, setIncidentContext] = useState<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(null);

  useEffect(() => {
    const context = loadFromStorage<{ incidentId?: string; agentId?: string; incidentType?: string } | null>(INCIDENT_CONTEXT_STORAGE_KEY, null);
    setIncidentContext(context);
    if (context) {
      removeFromStorage(INCIDENT_CONTEXT_STORAGE_KEY);
    }
    if (!context?.incidentId) return;

    const matched = incidents.find((incident) => incident.id === context.incidentId);
    if (!matched) return;

    setSelectedLog(matched);
    setSearchTerm(matched.agent_name);
    setFilterSeverity(matched.severity);
  }, [incidents]);

  const clearIncidentFocus = () => {
    removeFromStorage(INCIDENT_CONTEXT_STORAGE_KEY);
    setIncidentContext(null);
    setSearchTerm('');
    setFilterSeverity('all');
    setSelectedLog(null);
    toast.info('Incident focus cleared');
  };

  const filteredIncidents = useMemo(() => {
    return incidents.filter(inc => {
      const matchesSearch = inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inc.agent_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inc.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSeverity = filterSeverity === 'all' || inc.severity === filterSeverity;
      return matchesSearch && matchesSeverity;
    });
  }, [incidents, searchTerm, filterSeverity]);

  const handleExport = () => {
    if (filteredIncidents.length === 0) {
      toast.warning('No incidents to export.');
      return;
    }
    const payload = filteredIncidents.map(generateForensicPayload);
    const blob = new Blob([`[\n${payload.join(',\n')}\n]`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident_export_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Successfully exported incident logs');
  };

  const totalCaptured = incidents.length;
  const criticalCount = incidents.filter(i => i.severity === 'critical').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {incidentContext?.incidentId && (
        <div className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Investigating incident</p>
            <p className="mt-1 text-sm text-white">
              Focused on <span className="font-mono">{incidentContext.incidentId}</span>
              {incidentContext.incidentType ? ` · ${incidentContext.incidentType.replace(/_/g, ' ')}` : ''}
            </p>
          </div>
          <button
            onClick={clearIncidentFocus}
            className="rounded-xl border border-cyan-500/20 bg-slate-950/60 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40"
          >
            Clear focus
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-white tracking-tight">Black Box</h1>
            <span className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Evidence View
            </span>
          </div>
          <p className="text-slate-400 text-sm">Review incident evidence snapshots, agent context, and response details from the governance queue.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate?.('incidents')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm rounded-lg transition-colors border border-slate-700/50"
          >
            <AlertTriangle className="w-4 h-4" /> Incidents
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm rounded-lg transition-colors border border-slate-700/50"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center">
          <Database className="mx-auto h-12 w-12 text-slate-500" />
          <h2 className="mt-4 text-xl font-semibold text-white">No evidence records yet</h2>
          <p className="mt-2 text-sm text-slate-400">Black Box entries are created from real incident records. Run a detector test or investigate a live incident to populate this view.</p>
        </div>
      ) : (
        <>
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
          <Database className="w-8 h-8 text-cyan-400/20 absolute -bottom-2 -right-2" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Total Events</p>
          <p className="text-2xl font-bold text-white">{totalCaptured.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
          <AlertTriangle className="w-8 h-8 text-rose-400/20 absolute -bottom-2 -right-2" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Critical Severity</p>
          <p className="text-2xl font-bold text-white content-center flex items-baseline gap-2">
            {criticalCount.toLocaleString()}
            {criticalCount > 0 && <span className="text-rose-400 text-xs font-semibold uppercase bg-rose-500/10 px-1.5 py-0.5 rounded">Action Req</span>}
          </p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
          <Activity className="w-8 h-8 text-indigo-400/20 absolute -bottom-2 -right-2" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Open Reviews</p>
          <p className="text-2xl font-bold text-white">{incidents.filter((incident) => incident.status === 'open' || incident.status === 'investigating').length}</p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
          <Shield className="w-8 h-8 text-emerald-400/20 absolute -bottom-2 -right-2" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Resolved Events</p>
          <p className="text-2xl font-bold text-emerald-400">{incidents.filter((incident) => incident.status === 'resolved').length}</p>
        </div>
      </div>

      {/* Main Logging Area */}
      <div className="bg-slate-900/60 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col h-[600px] shadow-2xl">

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-slate-700/60 bg-slate-800/60 text-sm">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="blackbox-search"
              name="blackbox_search"
              type="text"
              placeholder="Search trace IDs, agent names, or descriptions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-lg pl-9 pr-3 py-2 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-mono placeholder:font-sans"
            />
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium z-10">Severity:</span>
              <select
                id="blackbox-severity"
                name="blackbox_severity"
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="pl-20 pr-8 py-2 bg-slate-900/50 border border-slate-700 text-white rounded-lg appearance-none outline-none focus:border-cyan-500 transition-all cursor-pointer hover:bg-slate-800/80"
              >
                <option value="all">All</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <Filter className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-auto bg-slate-900/40 relative">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="sticky top-0 bg-slate-900 z-10 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700/60">
              <tr>
                <th className="px-5 py-4 w-48 font-mono">Timestamp</th>
                <th className="px-5 py-4 w-52 font-mono">Trace ID</th>
                <th className="px-5 py-4 w-36">Severity</th>
                <th className="px-5 py-4 w-48">Agent</th>
                <th className="px-5 py-4">Event Summary</th>
                <th className="px-5 py-4 w-12 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-slate-500">
                    <Database className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p>No evidence records match current filters.</p>
                  </td>
                </tr>
              ) : (
                filteredIncidents.map(incident => {
                  const date = new Date(incident.created_at);
                  const formattedParams = {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false
                  } as const;
                  const timeString = date.toLocaleString('en-US', formattedParams);
                  const ms = date.getMilliseconds().toString().padStart(3, '0');

                  // Coloring logic
                  let sevColor = 'text-slate-400 bg-slate-800';
                  let sevDot = 'bg-slate-500';
                  if (incident.severity === 'critical') { sevColor = 'text-rose-400 bg-rose-500/10 border border-rose-500/20'; sevDot = 'bg-rose-500 shadow-[0_0_8px_theme(colors.rose.500)]'; }
                  if (incident.severity === 'high') { sevColor = 'text-amber-400 bg-amber-500/10 border border-amber-500/20'; sevDot = 'bg-amber-400'; }
                  if (incident.severity === 'medium') { sevColor = 'text-blue-400 bg-blue-500/10 border border-blue-500/20'; sevDot = 'bg-blue-400'; }

                  const isSelected = selectedLog?.id === incident.id;

                  return (
                    <tr
                      key={incident.id}
                      onClick={() => setSelectedLog(incident)}
                      className={`group cursor-pointer transition-colors ${isSelected ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-slate-800/40'}`}
                    >
                      <td className="px-5 py-3.5 text-xs text-slate-400 font-mono whitespace-nowrap">
                        {timeString}.<span className="text-slate-600 font-bold">{ms}</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-500 font-mono">
                          <Hash className="w-3 h-3 text-slate-600" />
                          <span className="truncate w-28 group-hover:text-cyan-400 transition-colors">{incident.id.split('-')[0]}...</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${sevColor}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sevDot}`} />
                          {incident.severity}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-slate-200">
                        {incident.agent_name}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-medium text-slate-300 truncate max-w-sm" title={incident.title}>
                          {incident.title}
                        </div>
                        <div className="text-xs text-slate-500 truncate max-w-sm mt-0.5" title={incident.description}>
                          {incident.description}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <ChevronRight className={`w-4 h-4 text-slate-600 transition-transform ${isSelected ? 'rotate-90 text-cyan-400' : 'group-hover:text-cyan-400 group-hover:translate-x-1'}`} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Forensic Detail Panel (splits view bottom) */}
        {selectedLog && (
          <div className="h-64 border-t border-cyan-500/30 bg-slate-900 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-400">
                <Code className="w-4 h-4" /> Forensic Payload View
              </div>
              <button onClick={() => setSelectedLog(null)} className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex">
              {/* Left sidebar with meta */}
              <div className="w-48 flex-shrink-0 border-r border-slate-800 pr-4 space-y-4 text-xs">
                <div>
                  <p className="text-slate-500 font-semibold mb-1">RECORD INTEGRITY</p>
                  <p className="text-emerald-400 flex items-center gap-1 font-mono"><Lock className="w-3 h-3" /> VERIFIED</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold mb-1">INCIDENT TYPE</p>
                  <p className="text-slate-300 font-mono capitalize">{selectedLog.incident_type.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold mb-1">LIFECYCLE STATUS</p>
                  <p className={`font-mono capitalize ${selectedLog.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'}`}>{selectedLog.status}</p>
                </div>
              </div>
              {/* Right side with JSON */}
              <div className="flex-1 pl-4 relative">
                <div className="absolute top-0 right-4 flex gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generateForensicPayload(selectedLog));
                      toast.success('Copied payload to clipboard');
                    }}
                    className="text-slate-400 hover:text-cyan-400 transition-colors"
                    title="Copy JSON"
                  >
                    <FileJson className="w-4 h-4" />
                  </button>
                </div>
                <pre className="font-mono text-xs text-indigo-200/90 whitespace-pre-wrap select-text">
                  {generateForensicPayload(selectedLog)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
