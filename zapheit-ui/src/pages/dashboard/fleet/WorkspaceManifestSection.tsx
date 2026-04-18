/**
 * WorkspaceManifestSection.tsx
 *
 * Agent Registry / Manifest — the agent's "employment file".
 * Displays declared capabilities, SLO targets, and live compliance status.
 * Allows editing manifest fields inline.
 */

import { useEffect, useState } from 'react';
import {
  FileText, Tag, User, Globe, BarChart2, CheckCircle2, XCircle,
  AlertCircle, Edit2, Save, X, Plus, RefreshCw,
} from 'lucide-react';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';

interface Props {
  agent: AIAgent;
}

type Manifest = NonNullable<Awaited<ReturnType<typeof api.agents.getManifest>>['data']>['manifest'];
type SloStatus = NonNullable<Awaited<ReturnType<typeof api.agents.getManifest>>['data']>['slo_status'];

const ENV_LABELS: Record<string, string> = {
  production: 'Production',
  staging: 'Staging',
  sandbox: 'Sandbox',
};

const CADENCE_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  none: 'None',
};

function SloIndicator({ label, target, actual, passing, unit = '' }: {
  label: string;
  target: number | null;
  actual: number | null;
  passing: boolean | null;
  unit?: string;
}) {
  const color = passing === true ? 'text-emerald-400' : passing === false ? 'text-rose-400' : 'text-slate-400';
  const Icon = passing === true ? CheckCircle2 : passing === false ? XCircle : AlertCircle;
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/40 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        {target !== null && (
          <span className="text-[10px] text-slate-500">target: {target}{unit}</span>
        )}
        {actual !== null && (
          <span className={`text-xs font-medium ${color}`}>{actual}{unit}</span>
        )}
        {passing !== null && <Icon className={`w-3.5 h-3.5 ${color}`} />}
        {actual === null && <span className="text-[10px] text-slate-600 italic">no data</span>}
      </div>
    </div>
  );
}

export default function WorkspaceManifestSection({ agent }: Props) {
  const [manifest, setManifest] = useState<Manifest>({});
  const [sloStatus, setSloStatus] = useState<SloStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Manifest>({});
  const [newCapability, setNewCapability] = useState('');
  const [newTag, setNewTag] = useState('');

  const load = () => {
    setLoading(true);
    api.agents.getManifest(agent.id)
      .then(res => {
        if (res.success && res.data) {
          setManifest(res.data.manifest);
          setSloStatus(res.data.slo_status);
          setDraft(res.data.manifest);
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [agent.id]);

  const startEdit = () => {
    setDraft({ ...manifest });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft({ ...manifest });
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.agents.updateManifest(agent.id, draft);
      if (res.success) {
        setManifest(draft);
        setEditing(false);
        toast.success('Manifest saved');
        load(); // Refresh SLO status
      } else {
        toast.error(res.error ?? 'Save failed');
      }
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addCapability = () => {
    const cap = newCapability.trim();
    if (!cap) return;
    setDraft(d => ({ ...d, capabilities: [...(d.capabilities ?? []), cap] }));
    setNewCapability('');
  };

  const removeCapability = (cap: string) => {
    setDraft(d => ({ ...d, capabilities: (d.capabilities ?? []).filter(c => c !== cap) }));
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    setDraft(d => ({ ...d, tags: [...(d.tags ?? []), tag] }));
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    setDraft(d => ({ ...d, tags: (d.tags ?? []).filter(t => t !== tag) }));
  };

  if (loading) {
    return (
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 animate-pulse">
        <div className="h-4 bg-slate-700/50 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-3 bg-slate-700/40 rounded w-3/4" />)}
        </div>
      </div>
    );
  }

  const current = editing ? draft : manifest;

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200">Agent Manifest</h2>
          {current.deployment_environment && (
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
              current.deployment_environment === 'production'
                ? 'bg-emerald-500/15 text-emerald-400'
                : current.deployment_environment === 'staging'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-slate-500/20 text-slate-400'
            }`}>
              {ENV_LABELS[current.deployment_environment]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1 text-slate-500 hover:text-slate-300 transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {!editing ? (
            <button onClick={startEdit} className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors">
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={cancelEdit} className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 rounded-lg transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-cyan-600/80 hover:bg-cyan-600 rounded-lg transition-colors disabled:opacity-50">
                <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left column: capabilities + tags + metadata */}
        <div className="space-y-4">
          {/* Capabilities */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {(current.capabilities ?? []).map(cap => (
                <span key={cap} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  {cap}
                  {editing && (
                    <button onClick={() => removeCapability(cap)} className="text-cyan-500 hover:text-rose-400 ml-0.5">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {(current.capabilities ?? []).length === 0 && !editing && (
                <span className="text-xs text-slate-600 italic">None declared</span>
              )}
              {editing && (
                <div className="flex items-center gap-1">
                  <input
                    value={newCapability}
                    onChange={e => setNewCapability(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCapability()}
                    placeholder="Add capability…"
                    className="px-2 py-0.5 text-[11px] bg-slate-900/60 border border-slate-600/50 rounded-full text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/50 w-32"
                  />
                  <button onClick={addCapability} className="text-cyan-500 hover:text-cyan-300">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Tag className="w-3 h-3" /> Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(current.tags ?? []).map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-700/60 text-slate-300 border border-slate-600/30">
                  {tag}
                  {editing && (
                    <button onClick={() => removeTag(tag)} className="text-slate-500 hover:text-rose-400 ml-0.5">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {(current.tags ?? []).length === 0 && !editing && (
                <span className="text-xs text-slate-600 italic">No tags</span>
              )}
              {editing && (
                <div className="flex items-center gap-1">
                  <input
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag()}
                    placeholder="Add tag…"
                    className="px-2 py-0.5 text-[11px] bg-slate-900/60 border border-slate-600/50 rounded-full text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/50 w-28"
                  />
                  <button onClick={addTag} className="text-slate-400 hover:text-slate-200">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Owner + Environment + Cadence */}
          <div className="space-y-2.5">
            {/* Owner */}
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {editing ? (
                <input
                  value={draft.owner_email ?? ''}
                  onChange={e => setDraft(d => ({ ...d, owner_email: e.target.value }))}
                  placeholder="owner@company.com"
                  className="flex-1 px-2 py-0.5 text-xs bg-slate-900/60 border border-slate-600/50 rounded text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/50"
                />
              ) : (
                <span className="text-xs text-slate-300">{current.owner_email || <span className="text-slate-600 italic">No owner set</span>}</span>
              )}
            </div>

            {/* Environment */}
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {editing ? (
                <select
                  value={draft.deployment_environment ?? ''}
                  onChange={e => setDraft(d => ({ ...d, deployment_environment: e.target.value as any }))}
                  className="flex-1 px-2 py-0.5 text-xs bg-slate-900/60 border border-slate-600/50 rounded text-slate-300 outline-none focus:border-cyan-500/50"
                >
                  <option value="">Select environment…</option>
                  {Object.entries(ENV_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <span className="text-xs text-slate-300">{ENV_LABELS[current.deployment_environment ?? ''] || <span className="text-slate-600 italic">Not set</span>}</span>
              )}
            </div>

            {/* Review cadence */}
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {editing ? (
                <select
                  value={draft.review_cadence ?? ''}
                  onChange={e => setDraft(d => ({ ...d, review_cadence: e.target.value as any }))}
                  className="flex-1 px-2 py-0.5 text-xs bg-slate-900/60 border border-slate-600/50 rounded text-slate-300 outline-none focus:border-cyan-500/50"
                >
                  <option value="">Review cadence…</option>
                  {Object.entries(CADENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <span className="text-xs text-slate-300">{CADENCE_LABELS[current.review_cadence ?? ''] || <span className="text-slate-600 italic">No cadence set</span>}</span>
              )}
            </div>
          </div>
        </div>

        {/* Right column: SLO targets + live status */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">SLO Status</p>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Min Satisfaction Score (0–100)</label>
                <input
                  type="number" min={0} max={100}
                  value={draft.slo_targets?.min_satisfaction ?? ''}
                  onChange={e => setDraft(d => ({ ...d, slo_targets: { ...d.slo_targets, min_satisfaction: Number(e.target.value) } }))}
                  className="w-full px-2 py-1 text-xs bg-slate-900/60 border border-slate-600/50 rounded text-slate-300 outline-none focus:border-cyan-500/50"
                  placeholder="e.g. 85"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">Max Cost / Request (USD)</label>
                <input
                  type="number" min={0} step={0.001}
                  value={draft.slo_targets?.max_cost_per_request_usd ?? ''}
                  onChange={e => setDraft(d => ({ ...d, slo_targets: { ...d.slo_targets, max_cost_per_request_usd: Number(e.target.value) } }))}
                  className="w-full px-2 py-1 text-xs bg-slate-900/60 border border-slate-600/50 rounded text-slate-300 outline-none focus:border-cyan-500/50"
                  placeholder="e.g. 0.05"
                />
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/40 rounded-xl p-3 space-y-0">
              <SloIndicator
                label="Satisfaction Score"
                target={sloStatus?.satisfaction.target ?? null}
                actual={sloStatus?.satisfaction.actual ?? null}
                passing={sloStatus?.satisfaction.passing ?? null}
                unit="%"
              />
              <SloIndicator
                label="Cost / Request"
                target={sloStatus?.cost_per_request.target != null ? Math.round(sloStatus.cost_per_request.target * 10000) / 10000 : null}
                actual={sloStatus?.cost_per_request.actual != null ? Math.round(sloStatus.cost_per_request.actual * 10000) / 10000 : null}
                passing={sloStatus?.cost_per_request.passing ?? null}
                unit=" USD"
              />
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-slate-400">Incidents (30d)</span>
                <span className={`text-xs font-medium ${(sloStatus?.incidents_30d ?? 0) === 0 ? 'text-emerald-400' : (sloStatus?.incidents_30d ?? 0) <= 2 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {sloStatus?.incidents_30d ?? '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {(editing || current.notes) && (
        <div className="mt-4 pt-4 border-t border-slate-700/40">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Notes</p>
          {editing ? (
            <textarea
              value={draft.notes ?? ''}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              rows={3}
              placeholder="Free-form notes about this agent…"
              className="w-full px-3 py-2 text-xs bg-slate-900/60 border border-slate-600/50 rounded-lg text-slate-300 placeholder-slate-600 outline-none focus:border-cyan-500/50 resize-none"
            />
          ) : (
            <p className="text-xs text-slate-400 whitespace-pre-wrap">{current.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}
