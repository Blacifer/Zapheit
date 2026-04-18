import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Check, ChevronDown, ChevronUp, Eye, Layers, RefreshCw,
  Search, SlidersHorizontal, Sparkles, X, Zap, DollarSign, Brain,
  BarChart2, Copy, ExternalLink,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { getFrontendConfig } from '../../lib/config';
import { supabase } from '../../lib/supabase-client';
import {
  FALLBACK_MODELS, PROVIDER_LABELS, getCostTier, formatPricing,
  type ModelDefinition,
} from '../../lib/models';

// ─── Types ───────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'provider' | 'context' | 'price_asc' | 'price_desc';
type CostFilter = 'all' | 'economy' | 'standard' | 'premium';

const CAPABILITY_OPTIONS = [
  { id: 'vision', label: 'Vision', icon: Eye },
  { id: 'function_calling', label: 'Tool Use', icon: Zap },
  { id: 'audio', label: 'Audio', icon: Brain },
  { id: 'embeddings', label: 'Embeddings', icon: Layers },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function providerLabel(id: string) {
  const prefix = id.split('/')[0] || '';
  return PROVIDER_LABELS[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function contextLabel(n?: number | null) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function inputPricePer1M(m: ModelDefinition) {
  if (!m.pricing) return Infinity;
  const v = parseFloat(m.pricing.prompt) * 1_000_000;
  return isNaN(v) ? Infinity : v;
}

// ─── Compare Panel ────────────────────────────────────────────────────────────

function ComparePanel({ models, onRemove, onClose }: {
  models: ModelDefinition[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  if (models.length === 0) return null;

  const rows: { label: string; getValue: (m: ModelDefinition) => string }[] = [
    { label: 'Provider', getValue: (m) => providerLabel(m.id) },
    { label: 'Context window', getValue: (m) => contextLabel(m.context_length) },
    { label: 'Input (per 1M tokens)', getValue: (m) => m.pricing ? `$${(parseFloat(m.pricing.prompt) * 1_000_000).toFixed(4)}` : '—' },
    { label: 'Output (per 1M tokens)', getValue: (m) => m.pricing ? `$${(parseFloat(m.pricing.completion) * 1_000_000).toFixed(4)}` : '—' },
    { label: 'Capabilities', getValue: (m) => (m.capabilities || []).join(', ') || '—' },
    { label: 'Cost tier', getValue: (m) => getCostTier(m.pricing) },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-400" />
            Comparing {models.length} model{models.length > 1 ? 's' : ''}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr>
                <th className="text-slate-400 pr-4 pb-2 w-36">Property</th>
                {models.map((m) => (
                  <th key={m.id} className="pb-2 pr-6 min-w-[180px]">
                    <div className="flex items-start gap-2">
                      <div>
                        <div className="text-white font-medium">{m.name}</div>
                        <div className="text-slate-400 text-xs">{providerLabel(m.id)}</div>
                      </div>
                      <button onClick={() => onRemove(m.id)} className="text-slate-500 hover:text-slate-300 mt-0.5">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-slate-800">
                  <td className="py-1.5 pr-4 text-slate-400">{row.label}</td>
                  {models.map((m) => (
                    <td key={m.id} className="py-1.5 pr-6 text-slate-200">{row.getValue(m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Model Card ───────────────────────────────────────────────────────────────

function ModelCard({ model, selected, onToggleCompare }: {
  model: ModelDefinition;
  selected: boolean;
  onToggleCompare: () => void;
}) {
  const tier = getCostTier(model.pricing);
  const tierColors = {
    economy: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    standard: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    premium: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };
  const provider = providerLabel(model.id);

  return (
    <div className={`bg-slate-800/60 border rounded-xl p-4 flex flex-col gap-3 transition-all hover:border-slate-600 ${selected ? 'border-cyan-500/60 ring-1 ring-cyan-500/30' : 'border-slate-700'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{model.name}</div>
          <div className="text-xs text-slate-400 truncate">{provider}</div>
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ${tierColors[tier]}`}>
          {tier}
        </span>
      </div>

      {/* Pricing */}
      <div className="bg-slate-900/60 rounded-lg p-2.5 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Input</span>
          <span className="text-slate-200 font-mono">
            {model.pricing ? `$${(parseFloat(model.pricing.prompt) * 1_000_000).toFixed(4)}/1M` : '—'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Output</span>
          <span className="text-slate-200 font-mono">
            {model.pricing ? `$${(parseFloat(model.pricing.completion) * 1_000_000).toFixed(4)}/1M` : '—'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Context</span>
          <span className="text-slate-200">{contextLabel(model.context_length)}</span>
        </div>
      </div>

      {/* Capabilities */}
      {model.capabilities && model.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {model.capabilities.map((cap) => (
            <span key={cap} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
              {cap.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <button
          onClick={onToggleCompare}
          className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
            selected
              ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
              : 'border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200'
          }`}
        >
          {selected ? <span className="flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Added</span> : 'Compare'}
        </button>
        <button
          onClick={() => { navigator.clipboard.writeText(model.id); toast.success('Model ID copied'); }}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          title="Copy model ID"
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ModelCatalogPage() {
  const [models, setModels] = useState<ModelDefinition[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('All');
  const [costFilter, setCostFilter] = useState<CostFilter>('all');
  const [capFilters, setCapFilters] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);

  // Fetch live catalog
  useEffect(() => {
    const apiUrl = (getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch(`${apiUrl}/models`, { headers })
        .then((r) => r.ok ? r.json() : null)
        .then((json) => {
          if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
            setModels(json.data);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setVisibleCount(60);
    const apiUrl = (getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch(`${apiUrl}/models`, { headers })
        .then((r) => r.ok ? r.json() : null)
        .then((json) => {
          if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
            setModels(json.data);
            toast.success(`${json.data.length} models loaded`);
          }
        })
        .catch(() => toast.error('Could not refresh catalog'))
        .finally(() => setLoading(false));
    });
  }, []);

  // Unique provider list
  const providers = useMemo(() => {
    const set = new Set(models.map((m) => m.id.split('/')[0] || 'Unknown'));
    return ['All', ...Array.from(set).sort()];
  }, [models]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = models.filter((m) => {
      const q = search.toLowerCase();
      if (q && !m.id.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q) && !(m.provider || '').toLowerCase().includes(q)) return false;
      if (providerFilter !== 'All' && (m.id.split('/')[0] || '') !== providerFilter) return false;
      if (costFilter !== 'all' && getCostTier(m.pricing) !== costFilter) return false;
      if (capFilters.length > 0 && !capFilters.every((c) => (m.capabilities || []).includes(c))) return false;
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'provider') cmp = (a.id.split('/')[0] || '').localeCompare(b.id.split('/')[0] || '');
      else if (sortBy === 'context') cmp = (a.context_length ?? 0) - (b.context_length ?? 0);
      else if (sortBy === 'price_asc' || sortBy === 'price_desc') cmp = inputPricePer1M(a) - inputPricePer1M(b);
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [models, search, providerFilter, costFilter, capFilters, sortBy, sortDir]);

  const visible = filtered.slice(0, visibleCount);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) { toast.error('Compare up to 4 models at a time'); return prev; }
      return [...prev, id];
    });
  };

  const compareModels = useMemo(() => compareIds.map((id) => models.find((m) => m.id === id)).filter(Boolean) as ModelDefinition[], [compareIds, models]);

  return (
    <div className={`p-4 md:p-6 space-y-5 ${compareIds.length > 0 ? 'pb-64' : ''}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            Model Catalog
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {loading ? 'Loading…' : `${models.length} models available across ${providers.length - 1} providers`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {compareIds.length > 0 && (
            <span className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-3 py-1">
              {compareIds.length} selected for compare
            </span>
          )}
          <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:text-white hover:border-slate-600 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleCount(60); }}
            placeholder="Search models, providers…"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Provider */}
        <select
          value={providerFilter}
          onChange={(e) => { setProviderFilter(e.target.value); setVisibleCount(60); }}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          {providers.map((p) => (
            <option key={p} value={p}>{p === 'All' ? 'All Providers' : (PROVIDER_LABELS[p] || p)}</option>
          ))}
        </select>

        {/* Cost tier */}
        <select
          value={costFilter}
          onChange={(e) => { setCostFilter(e.target.value as CostFilter); setVisibleCount(60); }}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="all">All Tiers</option>
          <option value="economy">Economy</option>
          <option value="standard">Standard</option>
          <option value="premium">Premium</option>
        </select>

        {/* Capability filter toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${showFilters ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Capabilities
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Capability checkboxes */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
          {CAPABILITY_OPTIONS.map(({ id, label, icon: Icon }) => {
            const active = capFilters.includes(id);
            return (
              <button
                key={id}
                onClick={() => setCapFilters((prev) => active ? prev.filter((c) => c !== id) : [...prev, id])}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${active ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500'}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
          {capFilters.length > 0 && (
            <button onClick={() => setCapFilters([])} className="text-xs text-slate-400 hover:text-slate-200 px-2">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <span>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        {search && <span>· Searching "{search}"</span>}
        {providerFilter !== 'All' && <span>· Provider: {PROVIDER_LABELS[providerFilter] || providerFilter}</span>}
        {costFilter !== 'all' && <span>· Tier: {costFilter}</span>}
        {capFilters.length > 0 && <span>· Caps: {capFilters.join(', ')}</span>}
        <span className="ml-auto flex items-center gap-3">
          <span>Sort:</span>
          {(['name', 'provider', 'context', 'price_asc'] as SortKey[]).map((k) => {
            const labels: Record<string, string> = { name: 'Name', provider: 'Provider', context: 'Context', price_asc: 'Price' };
            const active = sortBy === k || (k === 'price_asc' && sortBy === 'price_desc');
            return (
              <button
                key={k}
                onClick={() => toggleSort(k === 'price_asc' && sortBy === 'price_asc' ? 'price_desc' : k)}
                className={`flex items-center gap-0.5 hover:text-white transition-colors ${active ? 'text-cyan-400' : ''}`}
              >
                {labels[k]}
                {active && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </button>
            );
          })}
        </span>
      </div>

      {/* Grid */}
      {loading && models.length === FALLBACK_MODELS.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-slate-800/40 border border-slate-700 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No models match your filters.</p>
          <button onClick={() => { setSearch(''); setProviderFilter('All'); setCostFilter('all'); setCapFilters([]); }} className="mt-3 text-xs text-cyan-400 hover:underline">
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visible.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                selected={compareIds.includes(m.id)}
                onToggleCompare={() => toggleCompare(m.id)}
              />
            ))}
          </div>

          {filtered.length > visibleCount && (
            <div className="text-center pt-4">
              <button
                onClick={() => setVisibleCount((v) => v + 60)}
                className="px-5 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {/* Compare panel */}
      <ComparePanel
        models={compareModels}
        onRemove={(id) => setCompareIds((prev) => prev.filter((x) => x !== id))}
        onClose={() => setCompareIds([])}
      />
    </div>
  );
}
