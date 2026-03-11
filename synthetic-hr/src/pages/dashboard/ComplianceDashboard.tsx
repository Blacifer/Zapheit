import { useState, useEffect } from 'react';
import { Shield, Download, AlertTriangle, FileText, TrendingUp, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api-client';
import type { ComplianceExport, ComplianceEvent } from '../../types';

export default function ComplianceDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [exports, setExports] = useState<ComplianceExport[]>([]);
  const [events, setEvents] = useState<ComplianceEvent[]>([]);
  const [exportRequesting, setExportRequesting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, exportsRes, eventsRes] = await Promise.all([
        api.compliance.getStats(30),
        api.compliance.getExports(),
        api.compliance.getEvents({ limit: 10 }),
      ]);

      if (statsRes.success) setStats(statsRes.data);
      if (exportsRes.success) setExports(exportsRes.data || []);
      if (eventsRes.success) setEvents(eventsRes.data || []);
    } catch (error) {
      console.error('Failed to load compliance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestExport = async (type: string) => {
    setExportRequesting(true);
    try {
      const result = await api.compliance.requestExport({
        export_type: type,
        date_range_start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        date_range_end: new Date().toISOString(),
      });

      if (result.success) {
        await loadData(); // Reload to show new export
      }
    } catch (error) {
      console.error('Failed to request export:', error);
    } finally {
      setExportRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-40 bg-slate-800/30 rounded-xl"></div>
        <div className="h-64 bg-slate-800/30 rounded-xl"></div>
      </div>
    );
  }

  const criticalEvents = events.filter((e) => e.severity === 'critical').length;
  const unresolvedViolations = events.filter(
    (e) => e.event_type === 'policy_violation' && e.remediation_status !== 'resolved'
  ).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Compliance & Governance</h1>
        <p className="text-slate-400 mt-2">Enterprise compliance, policy management, and audit trails</p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <Shield className="w-8 h-8 text-blue-400" />
            {unresolvedViolations === 0 ? (
              <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">Compliant</span>
            ) : (
              <span className="px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded">Action Needed</span>
            )}
          </div>
          <p className="text-3xl font-bold text-white">{stats?.active_policies || 0}</p>
          <p className="text-slate-400 text-sm">Active Policies</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <AlertTriangle className={`w-8 h-8 ${criticalEvents > 0 ? 'text-red-400' : 'text-green-400'}`} />
          </div>
          <p className={`text-3xl font-bold ${criticalEvents > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {criticalEvents}
          </p>
          <p className="text-slate-400 text-sm">Critical Events (30d)</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <FileText className="w-8 h-8 text-purple-400" />
          </div>
          <p className="text-3xl font-bold text-white">{stats?.total_events || 0}</p>
          <p className="text-slate-400 text-sm">Audit Events (30d)</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <Download className="w-8 h-8 text-cyan-400" />
          </div>
          <p className="text-3xl font-bold text-white">{stats?.recent_exports || 0}</p>
          <p className="text-slate-400 text-sm">Exports (30d)</p>
        </div>
      </div>

      {/* Compliance Exports Section */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-cyan-400" />
              Compliance Exports
            </h2>
            <p className="text-sm text-slate-400 mt-1">Generate SOC2, GDPR, or HIPAA compliance reports</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => requestExport('soc2')}
              disabled={exportRequesting}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              SOC2 Export
            </button>
            <button
              onClick={() => requestExport('gdpr')}
              disabled={exportRequesting}
              className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              GDPR Export
            </button>
            <button
              onClick={() => requestExport('full_audit')}
              disabled={exportRequesting}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              Full Audit
            </button>
          </div>
        </div>

        {exports.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No exports yet. Request your first compliance export above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {exports.slice(0, 5).map((exp) => (
              <div
                key={exp.id}
                className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700 rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      exp.status === 'completed'
                        ? 'bg-green-500/10'
                        : exp.status === 'failed'
                        ? 'bg-red-500/10'
                        : exp.status === 'processing'
                        ? 'bg-blue-500/10'
                        : 'bg-slate-700'
                    }`}
                  >
                    {exp.status === 'completed' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                    ) : exp.status === 'failed' ? (
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    ) : (
                      <TrendingUp className="w-5 h-5 text-blue-400 animate-pulse" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-white">{exp.export_type.toUpperCase()} Export</p>
                    <p className="text-xs text-slate-400">
                      {new Date(exp.requested_at).toLocaleDateString()} •{' '}
                      {exp.record_count ? `${exp.record_count} records` : 'Processing...'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1 rounded text-xs ${
                      exp.status === 'completed'
                        ? 'bg-green-500/10 text-green-400'
                        : exp.status === 'failed'
                        ? 'bg-red-500/10 text-red-400'
                        : exp.status === 'processing'
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {exp.status}
                  </span>
                  {exp.status === 'completed' && exp.file_url && (
                    <button className="px-3 py-1 bg-cyan-500 hover:bg-cyan-600 text-white text-xs rounded transition-colors">
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Compliance Events */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          Recent Compliance Events
        </h2>

        {events.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-slate-400">No compliance events recorded</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-700 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      event.severity === 'critical'
                        ? 'bg-red-400'
                        : event.severity === 'warning'
                        ? 'bg-yellow-400'
                        : 'bg-blue-400'
                    }`}
                  />
                  <div>
                    <p className="text-sm text-white">{event.event_type.replace(/_/g, ' ').toUpperCase()}</p>
                    <p className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      event.remediation_status === 'resolved'
                        ? 'bg-green-500/10 text-green-400'
                        : event.remediation_status === 'in_progress'
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {event.remediation_status || 'none'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Policy Summary */}
      {stats && stats.policies_by_level && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-blue-400" />
            Active Policies by Enforcement Level
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-2xl font-bold text-red-400">{stats.policies_by_level.block || 0}</p>
              <p className="text-sm text-slate-400">Block</p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <p className="text-2xl font-bold text-yellow-400">{stats.policies_by_level.warn || 0}</p>
              <p className="text-sm text-slate-400">Warn</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <p className="text-2xl font-bold text-blue-400">{stats.policies_by_level.audit || 0}</p>
              <p className="text-sm text-slate-400">Audit</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
