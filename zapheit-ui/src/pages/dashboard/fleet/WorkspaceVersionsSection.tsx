import { useState, useEffect, useCallback } from 'react';
import { History, RotateCcw, ChevronDown, ChevronUp, Loader2, AlertTriangle } from 'lucide-react';
import type { AIAgent, AgentVersion } from '../../../types';
import { api } from '../../../lib/api-client';

// Fields shown in the diff view (label, snapshot key)
const DIFF_FIELDS: Array<[string, string]> = [
  ['Name', 'name'],
  ['Description', 'description'],
  ['Model', 'model_name'],
  ['Platform', 'platform'],
  ['Agent Type', 'agent_type'],
  ['Risk Level', 'risk_level'],
  ['System Prompt', 'system_prompt'],
];

function DiffRow({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  const bStr = String(before ?? '—');
  const aStr = String(after ?? '—');
  if (bStr === aStr) return null;
  const isLong = bStr.length > 80 || aStr.length > 80;
  return (
    <div className={`text-xs ${isLong ? 'col-span-2' : ''}`}>
      <p className="text-slate-500 mb-1 font-medium">{label}</p>
      {isLong ? (
        <div className="space-y-1">
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 text-rose-300 font-mono whitespace-pre-wrap break-all line-clamp-4">
            {bStr}
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-emerald-300 font-mono whitespace-pre-wrap break-all line-clamp-4">
            {aStr}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap">
          <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono line-through">{bStr}</span>
          <span className="text-slate-500">→</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono">{aStr}</span>
        </div>
      )}
    </div>
  );
}

function VersionDiff({ version, currentAgent }: { version: AgentVersion; currentAgent: AIAgent }) {
  const snap = version.snapshot;
  const current: Record<string, unknown> = {
    name: currentAgent.name,
    description: currentAgent.description,
    model_name: currentAgent.model_name,
    platform: currentAgent.platform,
    agent_type: currentAgent.agent_type,
    risk_level: currentAgent.risk_level,
    system_prompt: currentAgent.system_prompt ?? '',
  };

  const changedFields = DIFF_FIELDS.filter(([, key]) => String(snap[key] ?? '—') !== String(current[key] ?? '—'));

  if (changedFields.length === 0) {
    return <p className="text-xs text-slate-500 italic">No differences from current configuration.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 mt-3">
      {changedFields.map(([label, key]) => (
        <DiffRow key={key} label={label} before={snap[key]} after={current[key]} />
      ))}
    </div>
  );
}

export function WorkspaceVersionsSection({
  agent,
  onRollbackSuccess,
}: {
  agent: AIAgent;
  onRollbackSuccess: (updated: AIAgent) => void;
}) {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.agents.getVersions(agent.id);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load versions');
      setVersions(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => { void load(); }, [load]);

  const handleRollback = async (version: AgentVersion) => {
    setRollingBack(version.id);
    setConfirmId(null);
    try {
      const res = await api.agents.rollbackToVersion(agent.id, version.id);
      if (!res.success || !res.data) throw new Error(res.error || 'Rollback failed');
      onRollbackSuccess(res.data as AIAgent);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <History className="w-4 h-4 text-blue-400" /> Version History
        </h4>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {loading && versions.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading version history…
        </div>
      ) : versions.length === 0 ? (
        <div className="text-xs text-slate-500 text-center py-8 bg-slate-800/40 rounded-xl border border-slate-700/50">
          No versions saved yet. Versions are created automatically each time you save settings.
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => {
            const isExpanded = expandedId === v.id;
            const isRolling = rollingBack === v.id;
            const isConfirming = confirmId === v.id;
            return (
              <div
                key={v.id}
                className="bg-slate-800/50 border border-slate-700/60 rounded-xl overflow-hidden"
              >
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-blue-300">v{v.version_number}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {v.change_summary || 'Config update'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(v.created_at)}
                      {v.changed_by_email ? ` · ${v.changed_by_email}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Rollback button / confirm */}
                    {isConfirming ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-amber-400">Restore this version?</span>
                        <button
                          onClick={() => void handleRollback(v)}
                          disabled={isRolling}
                          className="px-2.5 py-1 text-xs bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-lg hover:bg-amber-500/30 transition-colors"
                        >
                          {isRolling ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Yes, restore'}
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(v.id)}
                        disabled={!!rollingBack}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-700/80 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition-colors disabled:opacity-40"
                        title="Restore this version"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    )}
                    {/* Expand diff toggle */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="p-1 text-slate-400 hover:text-white transition-colors"
                      title={isExpanded ? 'Hide diff' : 'Show diff vs current'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Diff panel */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 px-4 py-3 bg-slate-900/30">
                    <p className="text-[11px] text-slate-500 mb-2 uppercase tracking-wider font-semibold">
                      Differences from current config
                    </p>
                    <VersionDiff version={v} currentAgent={agent} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-600 text-center">
        Up to 50 most recent versions shown · Restoring creates a new snapshot automatically
      </p>
    </div>
  );
}
